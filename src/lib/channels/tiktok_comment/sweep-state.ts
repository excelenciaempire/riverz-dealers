/**
 * Por dónde va el barrido profundo de TikTok, guardado en
 * `channel_connections.config.tiktok_deep_sweep`.
 *
 * Antes, una cuenta con más de 300 videos o un video con más de 600
 * comentarios hacía que el barrido terminara en error y, en el caso de los
 * videos, sin guardar nada: el tope estaba para no pagar una cuenta entera en
 * una corrida, pero en vez de cortar y seguir después, cortaba y tiraba todo.
 * Ahora el tope corta, se guarda el cursor de TikTok y la corrida siguiente
 * continúa desde ahí.
 */

export const TIKTOK_DEEP_SWEEP_KEY = "tiktok_deep_sweep";
/** Videos con un cursor de comentarios pendiente que se recuerdan, como mucho:
 *  `config` no puede crecer sin fin con cada video del catálogo. */
export const MAX_TRACKED_COMMENT_CURSORS = 200;

export type TikTokCursor = string | number;

export interface TikTokDeepSweepState {
  /** Página de `video/list` desde la que sigue el próximo barrido; `null` =
   *  empezar por el video más nuevo. */
  video_cursor: TikTokCursor | null;
  /** Por video, la página de `comment/list` desde la que sigue. */
  comment_cursors: Record<string, TikTokCursor>;
}

export function readDeepSweepState(raw: unknown): TikTokDeepSweepState {
  const out: TikTokDeepSweepState = { video_cursor: null, comment_cursors: {} };
  if (!raw || typeof raw !== "object") return out;
  const s = raw as Record<string, unknown>;
  if (isCursor(s.video_cursor)) out.video_cursor = s.video_cursor;
  if (s.comment_cursors && typeof s.comment_cursors === "object") {
    for (const [videoId, cursor] of Object.entries(s.comment_cursors as Record<string, unknown>)) {
      if (videoId && isCursor(cursor)) out.comment_cursors[videoId] = cursor;
    }
  }
  return out;
}

/**
 * El estado después de una corrida.
 *
 * `comments` lleva, por cada video que se terminó de leer en esta corrida, el
 * cursor desde el que sigue (`null` si se leyó hasta el final). Un video que
 * falló NO va en la lista: conserva el cursor que tenía y la corrida siguiente
 * vuelve a intentar desde el mismo punto.
 */
export function nextDeepSweepState(
  prev: TikTokDeepSweepState,
  update: {
    videoCursor: TikTokCursor | null;
    comments: Array<{ videoId: string; next: TikTokCursor | null }>;
  },
  maxTracked = MAX_TRACKED_COMMENT_CURSORS,
): TikTokDeepSweepState {
  const cursors = { ...prev.comment_cursors };
  for (const { videoId, next } of update.comments) {
    delete cursors[videoId];
    // Reinsertado al final: al podar se van primero los más viejos.
    if (next !== null) cursors[videoId] = next;
  }
  const entries = Object.entries(cursors);
  return {
    video_cursor: update.videoCursor,
    comment_cursors: Object.fromEntries(entries.slice(Math.max(0, entries.length - maxTracked))),
  };
}

function isCursor(v: unknown): v is TikTokCursor {
  return (typeof v === "string" && v.length > 0) || (typeof v === "number" && Number.isFinite(v));
}
