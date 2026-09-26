import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { savePollState } from "../poll-state";
import { backfillWhatsappConnection } from "./journal";

/**
 * Cómo va el historial de coexistencia de una conexión, y su relectura.
 *
 * Meta manda el historial de la app del comercio en tandas, una sola vez, y
 * nada en Riverz decía cuántas llegaron, hasta dónde avanzó ni si Meta avisó
 * que el comercio no lo comparte. Sin eso no hay forma de saber si el
 * historial está completo o si faltan chats. Cada tanda deja anotado en el
 * config de la conexión:
 *
 *   history_chunks_received / history_messages_received — lo recibido.
 *   last_history_at   — cuándo llegó la última tanda.
 *   history_phase / history_progress / history_chunk_order — el avance que
 *                       informa Meta (fase 0: último día; 1: hasta 90 días;
 *                       2: hasta 180 días; progreso de 0 a 100).
 *   history_complete  — la fase 2 llegó al 100 %.
 *   history_sync_error / history_sync_error_code — el error que manda Meta
 *                       en lugar de los hilos (2593109: el comercio apagó
 *                       "compartir historial" en la app).
 *
 * La tanda se procesa DESPUÉS de acusar recibo a Meta: si el proceso se
 * reinicia a mitad, Meta no la vuelve a mandar. El diario la tiene
 * (`journal.ts`), así que una hora después del pedido, con las entregas ya
 * quietas, el cron relee el diario de esa conexión una vez.
 */

interface HistoryChunk {
  metadata?: { phase?: unknown; chunk_order?: unknown; progress?: unknown };
  threads?: Array<{ id?: string; messages?: unknown[] }>;
  errors?: Array<{ code?: unknown; title?: string; message?: string }>;
}

interface HistoryBody {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: { metadata?: { phone_number_id?: unknown }; history?: HistoryChunk[] };
    }>;
  }>;
}

/** Lo que una entrega dice del historial de un número. */
export interface HistoryDelivery {
  chunks: number;
  messages: number;
  /** El avance más alto de la entrega (fase, progreso), si Meta lo mandó. */
  phase: number | null;
  progress: number | null;
  chunkOrder: number | null;
  error: { code: number | null; text: string } | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** ¿(fase, progreso) a va después que b? */
function ahead(
  a: { phase: number | null; progress: number | null },
  b: { phase: number | null; progress: number | null },
): boolean {
  if (a.phase === null) return false;
  if (b.phase === null) return true;
  if (a.phase !== b.phase) return a.phase > b.phase;
  return (a.progress ?? -1) > (b.progress ?? -1);
}

/** Lo que la entrega trae del historial de ESTE número. Null si no trae nada. */
export function readHistoryDelivery(
  payload: unknown,
  phoneNumberId: string,
): HistoryDelivery | null {
  const out: HistoryDelivery = {
    chunks: 0,
    messages: 0,
    phase: null,
    progress: null,
    chunkOrder: null,
    error: null,
  };
  let seen = false;
  for (const entry of (payload as HistoryBody | null)?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (change?.field !== "history" || !value?.history?.length) continue;
      if (String(value.metadata?.phone_number_id ?? "") !== phoneNumberId) continue;
      for (const chunk of value.history) {
        seen = true;
        const error = chunk?.errors?.[0];
        if (error) {
          const code = num(error.code);
          const detail = error.title || error.message || "";
          out.error = {
            code,
            text: [code, detail].filter((part) => part !== null && part !== "").join(": ").slice(0, 500),
          };
          continue;
        }
        out.chunks++;
        for (const thread of chunk?.threads ?? []) out.messages += thread?.messages?.length ?? 0;
        const mark = { phase: num(chunk?.metadata?.phase), progress: num(chunk?.metadata?.progress) };
        if (ahead(mark, out)) {
          out.phase = mark.phase;
          out.progress = mark.progress;
          out.chunkOrder = num(chunk?.metadata?.chunk_order);
        }
      }
    }
  }
  return seen ? out : null;
}

/**
 * Parche del config para una entrega: suma a los contadores de la fila y
 * conserva el avance más alto, porque las tandas pueden llegar desordenadas.
 */
export function historyProgressPatch(
  current: Record<string, unknown>,
  delivery: HistoryDelivery,
  nowIso: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { last_history_at: nowIso };
  if (delivery.chunks > 0) {
    patch.history_chunks_received = (num(current.history_chunks_received) ?? 0) + delivery.chunks;
    patch.history_messages_received =
      (num(current.history_messages_received) ?? 0) + delivery.messages;
  }
  const stored = { phase: num(current.history_phase), progress: num(current.history_progress) };
  const advanced = ahead(delivery, stored);
  if (advanced) {
    patch.history_phase = delivery.phase;
    patch.history_progress = delivery.progress;
    patch.history_chunk_order = delivery.chunkOrder;
  }
  const best = advanced ? delivery : stored;
  // Por las dudas de cómo cuenta Meta el progreso (por fase o total), sólo se
  // da por completo al terminar la última fase: nunca antes de tiempo.
  if (current.history_complete === true || ((best.phase ?? -1) >= 2 && (best.progress ?? -1) >= 100)) {
    patch.history_complete = true;
  }
  if (delivery.error) {
    patch.history_sync_error = delivery.error.text;
    patch.history_sync_error_code = delivery.error.code;
  }
  return patch;
}

/**
 * Anota en la conexión lo que trae una entrega en vivo del historial. Nunca
 * lanza: es telemetría, y los mensajes que vienen detrás importan más.
 */
export async function recordHistoryProgress(
  db: SupabaseClient,
  connection: ChannelConnection,
  payload: unknown,
): Promise<void> {
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const phoneNumberId = String(cfg.phone_number_id ?? connection.external_account_id ?? "");
  if (!phoneNumberId) return;
  const delivery = readHistoryDelivery(payload, phoneNumberId);
  if (!delivery) return;
  const now = new Date().toISOString();
  try {
    await savePollState(
      db,
      connection.id,
      (current) => historyProgressPatch(current, delivery, now),
      null,
      { complete: false },
    );
  } catch (err) {
    console.warn("[whatsapp/history] no se pudo anotar el avance del historial", {
      connectionId: connection.id,
      err,
    });
  }
}

/** Espera tras el pedido, y silencio de las entregas, antes de releer. */
const REPLAY_AFTER_MS = 60 * 60_000;

/** El diario se purga a los 14 días: después no queda nada que releer. */
const JOURNAL_RETENTION_MS = 14 * 24 * 60 * 60_000;

/**
 * ¿Toca releer el diario de esta conexión? Una hora después del pedido del
 * historial y con las tandas quietas hace una hora (si siguen llegando, la
 * relectura esperaría a la mitad). Una sola vez por pedido.
 */
export function historyReplayDue(cfg: Record<string, unknown>, nowMs: number): boolean {
  if (cfg.coexistence !== true) return false;
  const requestedAt = Date.parse(String(cfg.history_sync_requested_at ?? ""));
  if (!Number.isFinite(requestedAt)) return false;
  const sinceRequest = nowMs - requestedAt;
  if (sinceRequest < REPLAY_AFTER_MS || sinceRequest > JOURNAL_RETENTION_MS) return false;
  const lastChunk = Date.parse(String(cfg.last_history_at ?? ""));
  if (Number.isFinite(lastChunk) && nowMs - lastChunk < REPLAY_AFTER_MS) return false;
  const replayedAt = Date.parse(String(cfg.history_replay_at ?? ""));
  return !(Number.isFinite(replayedAt) && replayedAt >= requestedAt);
}

/**
 * Relee una vez el diario de la conexión con el backfill existente: todas las
 * conversaciones, como históricas (sin IA ni automatizaciones). Recupera lo que
 * se cortó y completa los archivos que llegaron en otra entrega. Devuelve null
 * si no correspondía.
 */
export async function replayHistoryOnce(
  db: SupabaseClient,
  connection: ChannelConnection,
  nowMs = Date.now(),
): Promise<{ ingested: number; error?: string } | null> {
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  if (!historyReplayDue(cfg, nowMs)) return null;
  const startedAt = new Date(nowMs).toISOString();
  // La marca va ANTES de correr: si el proceso muere a mitad, no se repite en
  // cada corrida del cron. Rehacerla a mano es el backfill de siempre.
  try {
    await savePollState(db, connection.id, { history_replay_at: startedAt }, null, {
      complete: false,
    });
  } catch (err) {
    console.warn("[whatsapp/history] no se pudo marcar la relectura", {
      connectionId: connection.id,
      err,
    });
    return null;
  }
  let result: { ingested: number; error?: string };
  try {
    result = await backfillWhatsappConnection(db, connection, {
      sinceIso: new Date(0).toISOString(),
      untilIso: startedAt,
    });
  } catch (err) {
    console.error("[whatsapp/history] relectura fallida", { connectionId: connection.id, err });
    result = { ingested: 0, error: "replay_failed" };
  }
  await savePollState(
    db,
    connection.id,
    { history_replay_result: { ...result, finished_at: new Date().toISOString() } },
    null,
    { complete: false },
  ).catch((err) =>
    console.warn("[whatsapp/history] no se pudo anotar la relectura", {
      connectionId: connection.id,
      err,
    }),
  );
  return result;
}
