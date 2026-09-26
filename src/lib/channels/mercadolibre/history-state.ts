import type { InboundEvent } from "../types";

/**
 * Estado de la importación histórica de Mercado Libre, sin I/O.
 *
 * Vive aparte de `history.ts` para poder probar la lógica de cursores sin
 * simular la API: es la parte que, si se equivoca, deja un hueco en la historia
 * o repite para siempre la misma página.
 */

/** Clave dentro de `channel_connections.config`. */
export const ML_MSG_BACKFILL_KEY = "ml_msg_backfill";
/** Hasta dónde hacia atrás se importa: un año de ventas y de preguntas. */
export const HISTORY_DAYS = 365;
/**
 * Un mensaje del comprador más nuevo que esto y sin respuesta del vendedor
 * entra como pendiente (suma no leído, pero no despierta al agente). Lo más
 * viejo, o lo ya contestado, entra como historia: rellena el hilo sin tapar la
 * bandeja con cientos de "no leídos" de ventas de hace meses.
 */
export const HISTORY_PENDING_MS = 7 * 86_400_000;
/**
 * Fallos seguidos de una misma fase antes de abandonarla. A una corrida cada
 * 5 minutos son unas dos horas: suficiente para descartar una caída pasajera y
 * no tan largo como para gastar cuota para siempre en algo que no va a andar.
 */
export const MAX_PHASE_FAILURES = 24;

export type BackfillPhase = "orders" | "questions" | "claims";
const PHASES: BackfillPhase[] = ["orders", "questions", "claims"];

/**
 * Cursor sobre los pedidos, del más nuevo al más viejo.
 *
 * Es por fecha y no por `offset` porque la búsqueda de pedidos de Mercado Libre
 * no pagina lejos: con un año de ventas el `offset` se pasa del tope. `before`
 * es la fecha del último pedido procesado; `offset` sólo crece en el caso raro
 * de muchos pedidos con la misma fecha, para no quedar dando vueltas.
 */
export interface OrdersCursor {
  before: string;
  offset: number;
}

export interface MlMsgBackfillState {
  v: 1;
  started_at: string;
  /** Límite inferior: nada anterior a esta fecha se importa. */
  horizon: string;
  /** `null` = fase terminada. */
  orders: OrdersCursor | null;
  questions: { offset: number } | null;
  claims: { offset: number } | null;
  fails: Record<BackfillPhase, number>;
  /** Fases abandonadas tras {@link MAX_PHASE_FAILURES} fallos seguidos. */
  abandoned: BackfillPhase[];
  /** Se completa sólo cuando las tres fases llegaron al final. */
  completed_at: string | null;
  runs: number;
  packs: number;
  messages: number;
  /** Hilos, preguntas o reclamos salteados por un error propio. */
  errors: number;
  last_run_at: string | null;
  last_error: string | null;
}

export function initialBackfillState(now: number): MlMsgBackfillState {
  const start = new Date(now).toISOString();
  return {
    v: 1,
    started_at: start,
    horizon: new Date(now - HISTORY_DAYS * 86_400_000).toISOString(),
    orders: { before: start, offset: 0 },
    questions: { offset: 0 },
    claims: { offset: 0 },
    fails: { orders: 0, questions: 0, claims: 0 },
    abandoned: [],
    completed_at: null,
    runs: 0,
    packs: 0,
    messages: 0,
    errors: 0,
    last_run_at: null,
    last_error: null,
  };
}

/**
 * Lo guardado en `config`, o un estado nuevo si no hay nada o está roto. Un
 * estado ilegible se reinicia en vez de abortar: la importación es idempotente
 * y repetirla sólo cuesta llamadas.
 */
export function readBackfillState(raw: unknown, now: number): MlMsgBackfillState {
  if (!raw || typeof raw !== "object") return initialBackfillState(now);
  const s = raw as Record<string, unknown>;
  if (s.v !== 1 || !isDate(s.started_at) || !isDate(s.horizon)) {
    return initialBackfillState(now);
  }
  const fails = (s.fails ?? {}) as Record<string, unknown>;
  return {
    v: 1,
    started_at: s.started_at,
    horizon: s.horizon,
    orders: readOrdersCursor(s.orders),
    questions: readOffsetCursor(s.questions),
    claims: readOffsetCursor(s.claims),
    fails: {
      orders: count(fails.orders),
      questions: count(fails.questions),
      claims: count(fails.claims),
    },
    abandoned: Array.isArray(s.abandoned)
      ? PHASES.filter((p) => (s.abandoned as unknown[]).includes(p))
      : [],
    completed_at: isDate(s.completed_at) ? s.completed_at : null,
    runs: count(s.runs),
    packs: count(s.packs),
    messages: count(s.messages),
    errors: count(s.errors),
    last_run_at: isDate(s.last_run_at) ? s.last_run_at : null,
    last_error: typeof s.last_error === "string" ? s.last_error : null,
  };
}

/** Marca la importación como terminada, pero sólo si no queda ninguna fase. */
export function finishIfDone(s: MlMsgBackfillState, now: number): MlMsgBackfillState {
  if (s.completed_at || s.orders || s.questions || s.claims) return s;
  return { ...s, completed_at: new Date(now).toISOString() };
}

export function recordPhaseSuccess(s: MlMsgBackfillState, phase: BackfillPhase): MlMsgBackfillState {
  if (!s.fails[phase]) return s;
  return { ...s, fails: { ...s.fails, [phase]: 0 } };
}

/**
 * Un fallo de la fase entera (no de un hilo suelto). Tras demasiados seguidos
 * la fase se abandona: queda anotada en `abandoned` para que se vea que la
 * historia quedó incompleta y por qué.
 */
export function recordPhaseFailure(
  s: MlMsgBackfillState,
  phase: BackfillPhase,
  error: string,
): MlMsgBackfillState {
  const fails = s.fails[phase] + 1;
  const next: MlMsgBackfillState = {
    ...s,
    fails: { ...s.fails, [phase]: fails },
    last_error: `${phase}: ${error}`.slice(0, 300),
  };
  if (fails < MAX_PHASE_FAILURES) return next;
  return {
    ...next,
    [phase]: null,
    abandoned: next.abandoned.includes(phase) ? next.abandoned : [...next.abandoned, phase],
  };
}

/**
 * Dónde retomar los pedidos después de consumir `consumedDates` (en el orden
 * en que llegaron, del más nuevo al más viejo) de una página pedida con
 * `cursor`.
 *
 * Si la fecha avanzó, el cursor pasa a la del pedido más viejo consumido y el
 * `offset` vuelve a cero: la próxima página se pide hasta esa fecha más un
 * segundo, así que los pedidos con la misma fecha que no se llegaron a leer
 * entran seguro (a costa de releer alguno, que es idempotente). Si no avanzó
 * —todo lo consumido comparte la fecha del cursor— se avanza por `offset` para
 * no pedir la misma página para siempre.
 */
export function nextOrdersCursor(cursor: OrdersCursor, consumedDates: string[]): OrdersCursor {
  const beforeMs = Date.parse(cursor.before);
  let oldest = beforeMs;
  for (const d of consumedDates) {
    const t = Date.parse(d);
    if (Number.isFinite(t) && t < oldest) oldest = t;
  }
  if (Number.isFinite(beforeMs) && oldest < beforeMs) {
    return { before: new Date(oldest).toISOString(), offset: 0 };
  }
  return { before: cursor.before, offset: cursor.offset + consumedDates.length };
}

/**
 * Siguiente `offset` de una búsqueda paginada, o `null` si ya no queda nada.
 *
 * `consumed` es cuánto de la página se procesó: si la corrida se cortó a mitad
 * (tope por corrida, un 429), se retoma justo ahí. Termina cuando la página vino
 * incompleta, cuando se alcanza el `total`, cuando se pasa el tope de `offset`
 * que admite la API o cuando se llegó al horizonte de fechas.
 */
export function nextSearchOffset(args: {
  offset: number;
  consumed: number;
  pageLength: number;
  limit: number;
  total?: unknown;
  maxOffset: number;
  reachedHorizon?: boolean;
}): number | null {
  const { offset, consumed, pageLength, limit, maxOffset } = args;
  if (consumed < pageLength && !args.reachedHorizon) return offset + consumed;
  if (args.reachedHorizon || pageLength < limit || pageLength === 0) return null;
  const next = offset + pageLength;
  const total = Number(args.total);
  if (Number.isFinite(total) && total > 0 && next >= total) return null;
  if (next > maxOffset) return null;
  return next;
}

/** Fecha en el formato que aceptan los filtros de búsqueda de Mercado Libre. */
export function mlSearchDate(ms: number): string {
  return new Date(ms).toISOString().replace("Z", "-00:00");
}

/**
 * Cómo entra un mensaje del comprador traído por la importación histórica.
 *
 * `historical` si ya fue contestado o si es viejo: rellena el hilo sin sumar no
 * leídos ni despertar a nadie. Si es reciente y nadie lo contestó, entra como
 * pendiente pero sin respuesta automática: el comercio tiene que verlo y un bot
 * contestando en diferido queda peor que nada.
 */
export function historyFlags(
  receivedAt: string,
  answered: boolean,
  now: number,
): Pick<InboundEvent, "historical" | "suppressAutoReply"> {
  const at = Date.parse(receivedAt);
  const old = !(now - at < HISTORY_PENDING_MS);
  return answered || old ? { historical: true } : { suppressAutoReply: true };
}

/** Aplica {@link historyFlags} a un hilo post-venta entero. */
export function markPackHistory(events: InboundEvent[], now: number): InboundEvent[] {
  const lastSellerAt = events
    .filter((e) => e.outbound)
    .reduce((max, e) => Math.max(max, Date.parse(e.receivedAt) || 0), 0);
  return events.map((e) => {
    if (e.outbound) return e;
    const at = Date.parse(e.receivedAt) || 0;
    return { ...e, ...historyFlags(e.receivedAt, at <= lastSellerAt, now) };
  });
}

function readOrdersCursor(raw: unknown): OrdersCursor | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!isDate(c.before)) return null;
  return { before: c.before, offset: count(c.offset) };
}

function readOffsetCursor(raw: unknown): { offset: number } | null {
  if (!raw || typeof raw !== "object") return null;
  return { offset: count((raw as Record<string, unknown>).offset) };
}

function count(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function isDate(v: unknown): v is string {
  return typeof v === "string" && Number.isFinite(Date.parse(v));
}
