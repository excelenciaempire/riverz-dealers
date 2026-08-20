import { supabaseAdmin } from "../admin-client";
import { ingestInboundEvent } from "../inbox-writer";
import { getFreshTikTokToken } from "./adapter";
import type { ChannelConnection } from "@/types";

const TT = "https://business-api.tiktok.com/open_api/v1.3";
const VIDEOS_PER_RUN = 10; // rate-limit friendly: newest videos carry ~all fresh comments
const VIDEOS_PER_PAGE = 20; // barrido profundo: máximo que acepta video/list
const MAX_VIDEO_PAGES = 15; // techo de seguridad (~300 videos por cuenta)
const COMMENTS_PER_VIDEO = 30; // TikTok cap: comment/list max_count must be <= 30
const MAX_COMMENT_PAGES = 20; // hasta 600 comentarios por video
/** Un comentario que descubrimos con más de estas horas encima ya pasó su
 *  momento: se guarda y se ve, pero nadie lo contesta solo. El poll rápido
 *  corre cada minuto, así que lo vivo entra fresco; esto sólo frena al
 *  barrido profundo y a los rescates de videos viejos. */
const STALE_COMMENT_MS = 2 * 60 * 60 * 1000;

/**
 * Polling ingest for TikTok comments (Accounts API has webhooks, but they
 * need per-app portal configuration post-approval — until then this cron IS
 * the inbound path, and afterwards it stays as the reconciliation backstop,
 * same pattern as Gmail/Outlook). Idempotent on externalMessageId
 * (comment_id). Also keeps tokens fresh as a side effect of every run —
 * the 24h access token would otherwise die between quiet days.
 * Wired via cron-tiktok-comments.
 *
 * Dos ritmos:
 *  - normal (cada minuto): sólo los 10 videos más nuevos, 11 llamadas por
 *    cuenta. Es lo que hace que un comentario recién puesto aparezca ya.
 *  - `deep` (cada 6 h): TODO el catálogo, paginado. Sin esto, un comentario
 *    sobre un video viejo no entraba nunca — así se perdieron 171 de los 193
 *    comentarios de la primera cuenta conectada.
 */
export async function pollAllTikTokConnections(
  opts: { deep?: boolean } = {},
): Promise<{ total: number; ingested: number; videos: number }> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("channel_connections")
    .select("*")
    .eq("channel", "tiktok_comment")
    // Include error/expired: getFreshTikTokToken refreshes + heals the row back
    // to 'connected'. Polling only 'connected' would permanently self-exclude a
    // connection whose token refresh transiently failed (it never self-heals).
    .in("status", ["connected", "error", "expired"]);
  const conns = (data ?? []) as ChannelConnection[];
  let ingested = 0;
  let videos = 0;

  for (const conn of conns) {
    try {
      const cfg = (conn.config ?? {}) as Record<string, unknown>;
      const businessId = String(cfg.business_id ?? "");
      if (!businessId) continue;
      const token = await getFreshTikTokToken(conn);

      const list = await listVideos(businessId, token, Boolean(opts.deep));
      videos += list.length;
      for (const video of list) {
        const videoId = String(video.item_id ?? video.video_id ?? "");
        if (!videoId) continue;
        const caption = String(video.caption ?? "").slice(0, 80);
        ingested += await ingestVideoComments(db, conn, businessId, token, videoId, caption);
      }
    } catch (err) {
      console.error(`[tiktok/poll] connection ${conn.id} failed:`, err);
    }
  }
  return { total: conns.length, ingested, videos };
}

/**
 * Videos de la cuenta, del más nuevo al más viejo. En modo normal una sola
 * página; en modo profundo pagina con el cursor que devuelve TikTok hasta
 * agotar el catálogo (o el techo de seguridad).
 */
async function listVideos(
  businessId: string,
  token: string,
  deep: boolean,
): Promise<Array<Record<string, unknown>>> {
  const headers = { "Access-Token": token };
  const fields = encodeURIComponent(JSON.stringify(["item_id", "caption", "create_time"]));
  const out: Array<Record<string, unknown>> = [];
  let cursor: string | number | undefined;

  for (let page = 0; page < (deep ? MAX_VIDEO_PAGES : 1); page++) {
    const url =
      `${TT}/business/video/list/?business_id=${encodeURIComponent(businessId)}` +
      `&fields=${fields}&max_count=${deep ? VIDEOS_PER_PAGE : VIDEOS_PER_RUN}` +
      (cursor === undefined ? "" : `&cursor=${encodeURIComponent(String(cursor))}`);
    const res = await fetch(url, { headers });
    const json = (await res.json().catch(() => ({}))) as {
      code?: number;
      data?: {
        videos?: Array<Record<string, unknown>>;
        has_more?: boolean;
        cursor?: string | number;
      };
    };
    if (!res.ok || (json.code ?? 0) !== 0) break;
    out.push(...(json.data?.videos ?? []));
    if (!json.data?.has_more || json.data.cursor === undefined) break;
    cursor = json.data.cursor;
  }
  return out;
}

/**
 * Ingiere los comentarios de UN video. Devuelve cuántos eran nuevos.
 * Idempotente por comment_id, así que llamarlo de más no duplica nada — lo usan
 * el cron (todos los videos) y el refresco del hilo abierto (un solo video).
 *
 * Pagina: `max_count` topea en 30, y un video con más de 30 comentarios dejaba
 * al resto afuera para siempre.
 */
export async function ingestVideoComments(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  businessId: string,
  token: string,
  videoId: string,
  caption?: string,
): Promise<number> {
  let ingested = 0;
  let cursor: string | number | undefined;

  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    // Solo los parámetros requeridos: business_id + video_id + max_count
    // (<=30) + cursor. Sin sort — el poll es idempotente, el orden no importa,
    // y cada parámetro extra es otra validación que puede rebotar con 40002.
    const cUrl =
      `${TT}/business/comment/list/?business_id=${encodeURIComponent(businessId)}` +
      `&video_id=${encodeURIComponent(videoId)}&max_count=${COMMENTS_PER_VIDEO}` +
      (cursor === undefined ? "" : `&cursor=${encodeURIComponent(String(cursor))}`);
    const cr = await fetch(cUrl, { headers: { "Access-Token": token } });
    const cj = (await cr.json().catch(() => ({}))) as {
      code?: number;
      data?: {
        comments?: Array<Record<string, unknown>>;
        has_more?: boolean;
        cursor?: string | number;
      };
    };
    if (!cr.ok || (cj.code ?? 0) !== 0) break;

    for (const c of cj.data?.comments ?? []) {
      const commentId = String(c.comment_id ?? c.id ?? "");
      const text = String(c.text ?? "");
      if (!commentId || !text) continue;
      // Skip the merchant's own comments/replies (owner flag or same id).
      if (c.owner === true || String(c.user_id ?? "") === businessId) continue;
      const username = String(c.username ?? c.user_name ?? "");
      const createdMs = c.create_time ? Number(c.create_time) * 1000 : Date.now();
      const created = new Date(createdMs).toISOString();
      const wrote = await ingestInboundEvent(db, {
        channel: "tiktok_comment",
        connection: conn,
        externalContactId: String(c.user_id ?? username ?? "tiktok"),
        contactName: String(c.display_name ?? username ?? "") || undefined,
        externalMessageId: commentId,
        // One conversation per (video, top-level comment) — replies to the
        // same comment thread together; sendText parses this key.
        externalThreadId: `video:${videoId}|comment:${String(c.parent_comment_id ?? commentId)}`,
        subject: caption ? `Video · ${caption}` : undefined,
        text,
        comment: {
          postId: videoId,
          parentCommentId: c.parent_comment_id ? String(c.parent_comment_id) : undefined,
        },
        receivedAt: created,
        // Rescate: entra a la bandeja y suma no leído, pero el agente no
        // contesta en diferido algo de hace días.
        suppressAutoReply: Date.now() - createdMs > STALE_COMMENT_MS,
        raw: c,
      });
      if (wrote) ingested++;
    }
    if (!cj.data?.has_more || cj.data.cursor === undefined) break;
    cursor = cj.data.cursor;
  }
  return ingested;
}

/**
 * Refresco puntual de un solo video, para el hilo que el usuario tiene abierto.
 * TikTok no empuja los comentarios al instante (ni siquiera su webhook, que se
 * dispara "dentro de 5 min"), así que mirar un hilo lo mantiene al día sin
 * subir la frecuencia del cron para toda la cuenta.
 */
export async function refreshTikTokVideo(
  conn: ChannelConnection,
  videoId: string,
): Promise<number> {
  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const businessId = String(cfg.business_id ?? "");
  if (!businessId || !videoId) return 0;
  const token = await getFreshTikTokToken(conn);
  return ingestVideoComments(supabaseAdmin(), conn, businessId, token, videoId);
}
