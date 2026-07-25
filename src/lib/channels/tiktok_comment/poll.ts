import { supabaseAdmin } from "../admin-client";
import { ingestInboundEvent } from "../inbox-writer";
import { getFreshTikTokToken } from "./adapter";
import type { ChannelConnection } from "@/types";

const TT = "https://business-api.tiktok.com/open_api/v1.3";
const VIDEOS_PER_RUN = 10; // rate-limit friendly: newest videos carry ~all fresh comments
const COMMENTS_PER_VIDEO = 50;

/**
 * Polling ingest for TikTok comments (Accounts API has webhooks, but they
 * need per-app portal configuration post-approval — until then this cron IS
 * the inbound path, and afterwards it stays as the reconciliation backstop,
 * same pattern as Gmail/Outlook). Idempotent on externalMessageId
 * (comment_id). Also keeps tokens fresh as a side effect of every run —
 * the 24h access token would otherwise die between quiet days.
 * Wired via cron-tiktok-comments.
 */
export async function pollAllTikTokConnections(): Promise<{
  total: number;
  ingested: number;
}> {
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

  for (const conn of conns) {
    try {
      const cfg = (conn.config ?? {}) as Record<string, unknown>;
      const businessId = String(cfg.business_id ?? "");
      if (!businessId) continue;
      const token = await getFreshTikTokToken(conn);
      const headers = { "Access-Token": token };

      // Newest videos first — fresh comments live on fresh posts.
      const vidsUrl =
        `${TT}/business/video/list/?business_id=${encodeURIComponent(businessId)}` +
        `&fields=${encodeURIComponent(JSON.stringify(["item_id", "caption", "create_time"]))}` +
        `&max_count=${VIDEOS_PER_RUN}`;
      const vr = await fetch(vidsUrl, { headers });
      const vj = (await vr.json().catch(() => ({}))) as {
        code?: number;
        data?: { videos?: Array<Record<string, unknown>> };
      };
      if (!vr.ok || (vj.code ?? 0) !== 0) continue;

      for (const video of vj.data?.videos ?? []) {
        const videoId = String(video.item_id ?? video.video_id ?? "");
        if (!videoId) continue;
        const caption = String(video.caption ?? "").slice(0, 80);

        const cUrl =
          `${TT}/business/comment/list/?business_id=${encodeURIComponent(businessId)}` +
          `&video_id=${encodeURIComponent(videoId)}&max_count=${COMMENTS_PER_VIDEO}` +
          `&sort_field=create_time&sort_order=DESC`;
        const cr = await fetch(cUrl, { headers });
        const cj = (await cr.json().catch(() => ({}))) as {
          code?: number;
          data?: { comments?: Array<Record<string, unknown>> };
        };
        if (!cr.ok || (cj.code ?? 0) !== 0) continue;

        for (const c of cj.data?.comments ?? []) {
          const commentId = String(c.comment_id ?? c.id ?? "");
          const text = String(c.text ?? "");
          if (!commentId || !text) continue;
          // Skip the merchant's own comments/replies (owner flag or same id).
          if (c.owner === true || String(c.user_id ?? "") === businessId) continue;
          const username = String(c.username ?? c.user_name ?? "");
          const created = c.create_time
            ? new Date(Number(c.create_time) * 1000).toISOString()
            : new Date().toISOString();
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
            raw: c,
          });
          if (wrote) ingested++;
        }
      }
    } catch (err) {
      console.error(`[tiktok/poll] connection ${conn.id} failed:`, err);
    }
  }
  return { total: conns.length, ingested };
}
