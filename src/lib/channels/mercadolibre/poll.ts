import { supabaseAdmin } from "../admin-client";
import { listConnections } from "../connections";
import { ingestInboundEvent } from "../inbox-writer";
import { getFreshMLToken } from "./adapter";
import type { InboundEvent } from "../types";
import { mercadoLibreFailure, type MercadoLibreSyncFailure } from "./sync-result";

const ML = "https://api.mercadolibre.com";
/** Preguntas por corrida. Ordenadas de la más nueva a la más vieja. */
const PAGE = 50;
/**
 * A partir de acá una pregunta rescatada entra como pendiente pero no despierta
 * al agente: contestar en diferido algo de hace días es peor que no contestarlo.
 * Mismo criterio que en comentarios y en los mensajes post-venta.
 */
const LIVE_WINDOW_MS = 60 * 60_000;

interface MlQuestion {
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

  for (const conn of conns) {
    try {
      const sellerId = String((conn.config as Record<string, unknown> | null)?.seller_id ?? "");
      if (!sellerId) throw new Error("conexión sin seller_id");
      const token = await getFreshMLToken(conn);
      const r = await fetch(
        `${ML}/questions/search?seller_id=${sellerId}&api_version=4` +
          `&sort_fields=date_created&sort_types=DESC&limit=${PAGE}`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      if (!r.ok) {
        const body = (await r.text().catch(() => "")).slice(0, 160);
        throw new Error(`questions/search HTTP ${r.status}${body ? `: ${body}` : ""}`);
      }
      const j = (await r.json()) as { questions?: MlQuestion[] };
      for (const q of j.questions ?? []) {
        if (!q.id || !q.text) continue;
        const buyerId = String(q.from?.id ?? q.buyer_id ?? "ml");
        const askedAt = q.date_created ?? new Date().toISOString();
        const base = {
          channel: "mercadolibre" as const,
          connection: conn,
          externalContactId: buyerId,
          externalThreadId: `q:${q.id}`,
          subject: q.item_id ? `Pregunta · ${q.item_id}` : undefined,
        };

        // La pregunta. Ya contestada ⇒ nadie tiene que volver a contestarla.
        const answered = Boolean(q.answer?.text);
        const stale = !(Date.now() - Date.parse(askedAt) < LIVE_WINDOW_MS);
        const question: InboundEvent = {
          ...base,
          externalMessageId: `q:${q.id}`,
          text: q.text,
          receivedAt: askedAt,
          suppressAutoReply: answered || stale,
          raw: q,
        };
        if (await ingestInboundEvent(db, question)) ingested++;

        // La respuesta del vendedor, escrita desde donde sea. Saliente: es
        // nuestra. Si salió de Riverz ya está guardada y el corte la descarta.
        if (q.answer?.text) {
          const answer: InboundEvent = {
            ...base,
            externalMessageId: `a:${q.id}`,
            text: q.answer.text,
            receivedAt: q.answer.date_created ?? askedAt,
            outbound: true,
            raw: q.answer,
          };
          if (await ingestInboundEvent(db, answer)) answers++;
        }
      }
    } catch (err) {
      console.error("[mercadolibre/poll] failed for", conn.id, err);
      failures.push(mercadoLibreFailure(conn.id, err));
    }
  }
  return { total: conns.length, ingested, answers, failures };
}
