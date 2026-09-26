import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { supabaseAdmin } from "../admin-client";
import { listConnections } from "../connections";
import { ingestInboundEvent } from "../inbox-writer";
import { savePollState } from "../poll-state";
import { buildPackEvents, getFreshMLToken, resolveMlNickname } from "./adapter";
import { backfillClaimsPage, MAX_CLAIMS } from "./claims-poll";
import { questionEvents, type MlQuestion } from "./poll";
import { isMlRateLimit, throwIfRateLimited } from "./rate-limit";
import {
  finishIfDone,
  markPackHistory,
  mlSearchDate,
  ML_MSG_BACKFILL_KEY,
  nextOrdersCursor,
  nextSearchOffset,
  readBackfillState,
  recordPhaseFailure,
  recordPhaseSuccess,
  type BackfillPhase,
  type MlMsgBackfillState,
} from "./history-state";
import { getLogger } from "@/lib/log/logger";
import {
  DEFAULT_CONNECTION_CONCURRENCY,
  forEachWithConcurrency,
} from "@/lib/async/concurrency";

const ML = "https://api.mercadolibre.com";
const log = getLogger("channels.mercadolibre.history");

/** Hilos post-venta por comercio y por corrida. */
const PACKS_PER_RUN = 25;
/** Pedidos por página de búsqueda (el máximo de Mercado Libre es 51). */
const ORDERS_PAGE = 50;
/** Páginas de preguntas por comercio y por corrida. */
const QUESTION_PAGES_PER_RUN = 2;
const QUESTIONS_PAGE = 50;
/** La búsqueda de preguntas no admite un `offset` mayor. */
const QUESTIONS_MAX_OFFSET = 1000;
/** Reclamos cerrados por comercio y por corrida. */
const CLAIMS_PER_RUN = 20;
/** Tiempo total de la importación dentro de la corrida del cron. */
const RUN_BUDGET_MS = 60_000;

interface RunContext {
  db: SupabaseClient;
  conn: ChannelConnection;
  sellerId: string;
  token: string;
  deadline: number;
  /** Lo hecho en ESTA corrida, para el resumen del cron. */
  run: { packs: number; questions: number; claims: number; messages: number };
}

export interface MlHistoryResult {
  /** Comercios con la importación todavía abierta. */
  sellers: number;
  packs: number;
  questions: number;
  claims: number;
  messages: number;
  completed: number;
  rateLimited: boolean;
  /** Fallos de un comercio entero. Van aparte de `failures` a propósito: la
   *  importación se retoma sola en la corrida siguiente y no tiene por qué
   *  hacer que el cron repita al instante todo lo demás. */
  errors: Array<{ connectionId: string; error: string }>;
}

/**
 * Importación histórica de Mercado Libre: conversaciones COMPLETAS del último
 * año para quien acaba de conectar (y para quien ya estaba conectado y tenía
 * hilos a medias).
 *
 * El sondeo de cada 5 minutos sólo mira lo reciente —las 50 preguntas más
 * nuevas, los no leídos y los pedidos de las últimas 48 h— y cada hilo traía
 * su primera página. Medido en un comercio: 14 de 33 hilos post-venta tenían
 * sólo los mensajes del comprador, sin una sola respuesta del vendedor.
 *
 * Recorre, de a poco y de lo más nuevo a lo más viejo, tres frentes:
 *
 *   - los pedidos del último año, y de cada uno su hilo post-venta entero
 *     (paginado, con los mensajes del vendedor como salientes y los adjuntos);
 *   - todas las preguntas, con la respuesta del vendedor como saliente;
 *   - los reclamos cerrados, que el sondeo sólo miraba 60 días hacia atrás.
 *
 * El avance vive en `channel_connections.config.ml_msg_backfill`: cada
 * corrida hace una porción acotada y la siguiente sigue donde quedó. Sólo se
 * marca como terminada cuando los tres frentes llegaron al final.
 *
 * Un 429 corta la corrida de TODOS los comercios sin mover el cursor más allá
 * de lo que se llegó a leer: la cuota es por aplicación. Un hilo roto, en
 * cambio, se saltea y la corrida sigue.
 *
 * Lo importado entra como historia —ni no leídos ni agente— salvo lo reciente
 * y sin contestar, que entra como pendiente (ver `historyFlags`). Todo pasa por
 * `ingestInboundEvent`, que corta por id externo: repetir no duplica.
 */
export async function backfillAllMercadoLibreHistory(
  opts: { budgetMs?: number } = {},
): Promise<MlHistoryResult> {
  const db = supabaseAdmin();
  const start = Date.now();
  const deadline = start + (opts.budgetMs ?? RUN_BUDGET_MS);
  // Sólo las sanas: una conexión en error ya la está peleando el sondeo, y la
  // historia puede esperar a que se recupere.
  const conns = (
    await listConnections(db, { channel: "mercadolibre", statuses: ["connected"] })
  ).filter((c) => !readBackfillState(config(c)[ML_MSG_BACKFILL_KEY], start).completed_at);

  const result: MlHistoryResult = {
    sellers: conns.length,
    packs: 0,
    questions: 0,
    claims: 0,
    messages: 0,
    completed: 0,
    rateLimited: false,
    errors: [],
  };
  await forEachWithConcurrency(conns, DEFAULT_CONNECTION_CONCURRENCY, async (conn) => {
    if (result.rateLimited || Date.now() > deadline) return;
    try {
      const r = await backfillOneSeller(db, conn, deadline);
      result.packs += r.run.packs;
      result.questions += r.run.questions;
      result.claims += r.run.claims;
      result.messages += r.run.messages;
      if (r.completed) result.completed++;
      if (r.rateLimited) result.rateLimited = true;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("ml history backfill failed", { connectionId: conn.id, error });
      result.errors.push({ connectionId: conn.id, error });
    }
  });
  return result;
}

async function backfillOneSeller(
  db: SupabaseClient,
  conn: ChannelConnection,
  deadline: number,
): Promise<{ run: RunContext["run"]; completed: boolean; rateLimited: boolean }> {
  const sellerId = String(config(conn).seller_id ?? "");
  if (!sellerId) throw new Error("conexión sin seller_id");
  const token = await getFreshMLToken(conn);

  // Mutable a propósito: cada fase deja escrito su avance apenas termina cada
  // unidad, así que un 429 o un fallo a mitad no pierde lo ya hecho.
  const state = readBackfillState(config(conn)[ML_MSG_BACKFILL_KEY], Date.now());
  state.runs++;
  state.last_run_at = new Date().toISOString();
  const ctx: RunContext = {
    db,
    conn,
    sellerId,
    token,
    deadline,
    run: { packs: 0, questions: 0, claims: 0, messages: 0 },
  };

  const phases: Record<BackfillPhase, (ctx: RunContext, s: MlMsgBackfillState) => Promise<boolean>> = {
    orders: ordersPhase,
    questions: questionsPhase,
    claims: claimsPhase,
  };
  let rateLimited = false;
  let current = state;
  for (const phase of Object.keys(phases) as BackfillPhase[]) {
    if (Date.now() > deadline) break;
    if (!current[phase]) continue;
    try {
      rateLimited = await phases[phase](ctx, current);
      if (rateLimited) break;
      current = recordPhaseSuccess(current, phase);
    } catch (err) {
      if (isMlRateLimit(err)) {
        rateLimited = true;
        break;
      }
      const message = err instanceof Error ? err.message : String(err);
      log.warn("ml history phase failed", { connectionId: conn.id, phase, error: message });
      current = recordPhaseFailure(current, phase, message);
    }
  }
  current = finishIfDone(current, Date.now());
  // Sólo esta clave, fusionada contra la fila fresca: el refresco del token y
  // el sondeo escriben otras claves de `config` en la misma corrida.
  await savePollState(db, conn.id, { [ML_MSG_BACKFILL_KEY]: current }, null, {
    complete: false,
  });
  return { run: ctx.run, completed: Boolean(current.completed_at), rateLimited };
}

/**
 * Pedidos del último año, del más nuevo al más viejo, y el hilo post-venta de
 * cada uno. Devuelve `true` si Mercado Libre cortó por cuota.
 */
async function ordersPhase(ctx: RunContext, s: MlMsgBackfillState): Promise<boolean> {
  const horizonMs = Date.parse(s.horizon);
  const seen = new Set<string>();
  let packs = 0;
  while (s.orders && packs < PACKS_PER_RUN && Date.now() < ctx.deadline) {
    const cursor = s.orders;
    const results = await searchOrders(ctx, cursor, horizonMs);
    const consumed: string[] = [];
    let stopped = false;
    let reachedHorizon = false;
    for (const o of results) {
      if (packs >= PACKS_PER_RUN || Date.now() > ctx.deadline) {
        stopped = true;
        break;
      }
      const date = String(o.date_created ?? "");
      if (Date.parse(date) < horizonMs) {
        reachedHorizon = true;
        break;
      }
      // Sin `pack_id` el hilo es el del pedido: en una compra de un solo
      // producto Mercado Libre no crea paquete.
      const packId = String(o.pack_id ?? o.id ?? "");
      if (packId && !seen.has(packId)) {
        seen.add(packId);
        packs++;
        try {
          await importPack(ctx, s, packId);
        } catch (err) {
          if (isMlRateLimit(err)) {
            // El cursor queda en el último pedido completo: este hilo se
            // vuelve a pedir entero en la corrida siguiente.
            s.orders = nextOrdersCursor(cursor, consumed);
            return true;
          }
          s.errors++;
          s.last_error = `pack ${packId}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
          log.warn("hilo histórico salteado", { connectionId: ctx.conn.id, packId, error: s.last_error });
        }
      }
      consumed.push(date);
    }
    const more = !reachedHorizon && (stopped || results.length === ORDERS_PAGE);
    s.orders = more ? nextOrdersCursor(cursor, consumed) : null;
  }
  return false;
}

async function importPack(ctx: RunContext, s: MlMsgBackfillState, packId: string): Promise<void> {
  const pack = await buildPackEvents({
    connection: ctx.conn,
    packId,
    sellerId: ctx.sellerId,
    token: ctx.token,
  });
  s.packs++;
  ctx.run.packs++;
  for (const event of markPackHistory(pack.events, Date.now())) {
    if (await ingestInboundEvent(ctx.db, event)) {
      s.messages++;
      ctx.run.messages++;
    }
  }
}

/**
 * Una página de pedidos hasta `cursor.before` (más un segundo, para no perder
 * los que comparten esa fecha) y desde el horizonte.
 */
async function searchOrders(
  ctx: RunContext,
  cursor: { before: string; offset: number },
  horizonMs: number,
): Promise<Array<{ id?: unknown; pack_id?: unknown; date_created?: unknown }>> {
  const to = Date.parse(cursor.before) + 1000;
  const url =
    `${ML}/orders/search?seller=${ctx.sellerId}` +
    `&order.date_created.from=${encodeURIComponent(mlSearchDate(horizonMs))}` +
    `&order.date_created.to=${encodeURIComponent(mlSearchDate(to))}` +
    `&sort=date_desc&limit=${ORDERS_PAGE}&offset=${cursor.offset}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${ctx.token}` } });
  throwIfRateLimited(r, "orders/search");
  if (!r.ok) throw new Error(`orders/search HTTP ${r.status}`);
  const j = (await r.json()) as {
    results?: Array<{ id?: unknown; pack_id?: unknown; date_created?: unknown }>;
  };
  return j.results ?? [];
}

/** Todas las preguntas del último año, paginadas. */
async function questionsPhase(ctx: RunContext, s: MlMsgBackfillState): Promise<boolean> {
  const horizonMs = Date.parse(s.horizon);
  const nicknames = new Map<string, string | undefined>();
  const auth = { authorization: `Bearer ${ctx.token}` };
  for (let p = 0; p < QUESTION_PAGES_PER_RUN && s.questions && Date.now() < ctx.deadline; p++) {
    const offset = s.questions.offset;
    const r = await fetch(
      `${ML}/questions/search?seller_id=${ctx.sellerId}&api_version=4` +
        `&sort_fields=date_created&sort_types=DESC&limit=${QUESTIONS_PAGE}&offset=${offset}`,
      { headers: auth },
    );
    throwIfRateLimited(r, "questions/search");
    if (!r.ok) throw new Error(`questions/search HTTP ${r.status}`);
    const j = (await r.json()) as { questions?: MlQuestion[]; total?: number };
    const page = j.questions ?? [];

    let consumed = 0;
    let reachedHorizon = false;
    for (const q of page) {
      if (Date.now() > ctx.deadline) break;
      if (Date.parse(q.date_created ?? "") < horizonMs) {
        reachedHorizon = true;
        break;
      }
      try {
        const buyerId = String(q.from?.id ?? q.buyer_id ?? "");
        if (buyerId && !nicknames.has(buyerId)) {
          nicknames.set(buyerId, await resolveMlNickname(buyerId, auth));
        }
        const events = questionEvents(ctx.conn, q, {
          mode: "history",
          now: Date.now(),
          contactName: nicknames.get(buyerId),
        });
        for (const event of events) {
          if (await ingestInboundEvent(ctx.db, event)) {
            s.messages++;
            ctx.run.messages++;
          }
        }
        ctx.run.questions++;
      } catch (err) {
        s.errors++;
        s.last_error = `question ${q.id}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
        log.warn("pregunta histórica salteada", { connectionId: ctx.conn.id, questionId: q.id, error: s.last_error });
      }
      consumed++;
    }
    const next = nextSearchOffset({
      offset,
      consumed,
      pageLength: page.length,
      limit: QUESTIONS_PAGE,
      total: j.total,
      maxOffset: QUESTIONS_MAX_OFFSET,
      reachedHorizon,
    });
    s.questions = next === null ? null : { offset: next };
  }
  return false;
}

/** Reclamos cerrados del último año: los que el sondeo ya no mira. */
async function claimsPhase(ctx: RunContext, s: MlMsgBackfillState): Promise<boolean> {
  if (!s.claims) return false;
  const offset = s.claims.offset;
  const r = await backfillClaimsPage(ctx.db, ctx.conn, ctx.token, {
    offset,
    limit: CLAIMS_PER_RUN,
    since: new Date(s.horizon),
    deadline: ctx.deadline,
  });
  s.messages += r.ingested;
  s.errors += r.errors;
  if (r.lastError) s.last_error = `claim: ${r.lastError}`.slice(0, 300);
  ctx.run.messages += r.ingested;
  ctx.run.claims += r.consumed;
  const next = nextSearchOffset({
    offset,
    consumed: r.consumed,
    pageLength: r.pageLength,
    limit: CLAIMS_PER_RUN,
    total: r.total,
    maxOffset: MAX_CLAIMS - CLAIMS_PER_RUN,
  });
  s.claims = next === null ? null : { offset: next };
  return r.rateLimited;
}

function config(conn: ChannelConnection): Record<string, unknown> {
  return (conn.config ?? {}) as Record<string, unknown>;
}
