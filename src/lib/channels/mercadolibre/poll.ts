import { supabaseAdmin } from "../admin-client";
import { isInactiveMLAccountError, recordInactiveMLAccount } from './account-health';
import { safeLocale } from '@/lib/i18n/server';
import { listConnections } from "../connections";
import { ingestInboundEvent } from "../inbox-writer";
import { getFreshMLToken } from "./adapter";
import type { InboundEvent } from "../types";
import type { ChannelConnection } from "@/types";
import { historyFlags } from "./history-state";
import {
  mercadoLibreFailure,
  type MercadoLibreSyncFailure,
} from "./sync-result";
import {
  DEFAULT_CONNECTION_CONCURRENCY,
  forEachWithConcurrency,
} from "@/lib/async/concurrency";

const ML = "https://api.mercadolibre.com";
/**
 * Preguntas por corrida, de la más nueva a la más vieja. Es el frente de lo
 * reciente: las anteriores las recorre, paginando, la importación histórica
 * (`history.ts`).
 */
const PAGE = 50;
/**
 * A partir de acá una pregunta rescatada entra como pendiente pero no despierta
 * al agente: contestar en diferido algo de hace días es peor que no contestarlo.
 * Mismo criterio que en comentarios y en los mensajes post-venta.
 */
const LIVE_WINDOW_MS = 60 * 60_000;

export interface MlQuestion {
  id?: number;
  text?: string;
  status?: string;
  item_id?: string;
  date_created?: string;
  from?: { id?: number };
  buyer_id?: number;
  answer?: { text?: string; status?: string; date_created?: string } | null;
}

/**
 * Preguntas de publicaciones de Mercado Libre — lado sondeo.
 *
 * Trae la pregunta Y la respuesta del vendedor. Antes pedía sólo
 * `status=UNANSWERED` y guardaba únicamente la pregunta, lo que dejaba dos
 * agujeros que se notaban como "faltan preguntas":
 *
 *   - Una pregunta contestada rápido desde la app de Mercado Libre sale de
 *     UNANSWERED antes de que ninguna corrida la vea: no existía en Riverz ni
 *     la pregunta ni la respuesta. Medido el 2026-08-07: el vendedor tenía 6
 *     preguntas, todas contestadas, y en la bandeja había 1.
 *   - De las que sí entraban, la respuesta escrita por fuera no llegaba nunca,
 *     así que el hilo mostraba la pregunta del cliente y ningún seguimiento
 *     —como si nadie hubiera contestado— aunque en Mercado Libre estuviera
 *     respondida.
 *
 * Por eso ahora pide TODAS las recientes: una pregunta contestada cuesta lo
 * mismo de traer y es la única forma de que el hilo se vea completo. El corte
 * por id externo de `ingestInboundEvent` hace que repetir corridas no duplique.
 */
export async function pollAllMercadoLibreConnections(): Promise<{
  total: number;
  ingested: number;
  answers: number;
  failures: MercadoLibreSyncFailure[];
}> {
  const db = supabaseAdmin();
  // error/expired incluidos: getFreshMLToken refresca y sana la fila, y son
  // justamente los vendedores con más chance de haber perdido una notificación
  // sin cuerpo.
  const conns = await listConnections(db, { channel: "mercadolibre" });
  let ingested = 0;
  let answers = 0;
  const failures: MercadoLibreSyncFailure[] = [];

  await forEachWithConcurrency(
    conns,
    DEFAULT_CONNECTION_CONCURRENCY,
    async (conn) => {
      try {
        const sellerId = String(
          (conn.config as Record<string, unknown> | null)?.seller_id ?? "",
        );
        if (!sellerId) throw new Error("conexión sin seller_id");
        const token = await getFreshMLToken(conn);
        const r = await fetch(
          `${ML}/questions/search?seller_id=${sellerId}&api_version=4` +
            `&sort_fields=date_created&sort_types=DESC&limit=${PAGE}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        if (!r.ok) {
          const body = (await r.text().catch(() => "")).slice(0, 500);
          const accountError = await recordInactiveMLAccount(db, conn.id, token, r.status, body, await safeLocale());
          throw new Error(
            accountError ?? `questions/search HTTP ${r.status}${body ? `: ${body}` : ""}`,
          );
        }
        const j = (await r.json()) as { questions?: MlQuestion[] };
        if (isInactiveMLAccountError(conn.last_error)) {
          const { error } = await db.from('channel_connections')
            .update({ status: 'connected', last_error: null })
            .eq('id', conn.id).eq('last_error', conn.last_error!);
          if (error) throw new Error(`ML account recovery persistence: ${error.message}`);
        }
        for (const q of j.questions ?? []) {
          for (const event of questionEvents(conn, q, { mode: "live", now: Date.now() })) {
            if (!(await ingestInboundEvent(db, event))) continue;
            if (event.outbound) answers++;
            else ingested++;
          }
        }
      } catch (err) {
        console.error("[mercadolibre/poll] failed for", conn.id, err);
        failures.push(mercadoLibreFailure(conn.id, err));
      }
    },
  );
  return { total: conns.length, ingested, answers, failures };
}

/**
 * Los eventos de UNA pregunta: la del comprador y, si la hay, la respuesta del
 * vendedor como saliente —escrita desde Riverz o desde la app de Mercado
 * Libre—. La comparten el sondeo y la importación histórica, que sólo cambian
 * cómo entra la pregunta:
 *
 *   - `live`: ya contestada o de hace más de una hora ⇒ pendiente sin
 *     respuesta automática.
 *   - `history`: contestada o vieja ⇒ historia (ni no leído ni agente); sin
 *     contestar y reciente ⇒ pendiente sin respuesta automática.
 */
export function questionEvents(
  conn: ChannelConnection,
  q: MlQuestion,
  opts: { mode: "live" | "history"; now: number; contactName?: string },
): InboundEvent[] {
  if (!q.id || !q.text) return [];
  const buyerId = String(q.from?.id ?? q.buyer_id ?? "ml");
  const askedAt = q.date_created ?? new Date(opts.now).toISOString();
  const answered = Boolean(q.answer?.text);
  const base = {
    channel: "mercadolibre" as const,
    connection: conn,
    externalContactId: buyerId,
    contactName: opts.contactName,
    externalThreadId: `q:${q.id}`,
    subject: q.item_id ? `Pregunta · ${q.item_id}` : undefined,
  };
  const flags =
    opts.mode === "history"
      ? historyFlags(askedAt, answered, opts.now)
      : { suppressAutoReply: answered || !(opts.now - Date.parse(askedAt) < LIVE_WINDOW_MS) };
  const events: InboundEvent[] = [
    { ...base, externalMessageId: `q:${q.id}`, text: q.text, receivedAt: askedAt, ...flags, raw: q },
  ];
  // Saliente: es nuestra. Si salió de Riverz ya está guardada y el corte por id
  // externo la descarta.
  if (q.answer?.text) {
    events.push({
      ...base,
      externalMessageId: `a:${q.id}`,
      text: q.answer.text,
      receivedAt: q.answer.date_created ?? askedAt,
      outbound: true,
      raw: q.answer,
    });
  }
  return events;
}
