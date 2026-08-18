import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { ingestInboundEvent } from "@/lib/channels/inbox-writer";
import { getFreshTikTokToken } from "@/lib/channels/tiktok_comment/adapter";
import { COMMENT_DELETED_TEXT } from "@/lib/channels/display";
import type { ChannelConnection } from "@/types";

const TT = "https://business-api.tiktok.com/open_api/v1.3";

/**
 * POST /api/tiktok/webhook
 *
 * TikTok Accounts API webhook (event `comment.update`). Fires within ~5 min of
 * a comment being created, deleted, or having its visibility changed on an
 * owned video — so an action taken directly in the TikTok app is reflected in
 * the Riverz inbox (and new comments arrive without waiting for the poll).
 *
 * Body: { client_key, event, create_time, user_openid, content } where
 * `user_openid` is the account's business_id and `content` is a serialized JSON
 * with { comment_id, video_id, parent_comment_id?, comment_type, comment_action }.
 *
 * Signature: header `TikTok-Signature: t=<unix>,s=<hmac>` where the HMAC is
 * SHA-256 of `${t}.${rawBody}` keyed by the app secret (hex). Verified before
 * processing; always answers 200 so TikTok doesn't retry (processing is
 * best-effort + idempotent).
 */
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const secret = process.env.TIKTOK_APP_SECRET ?? "";
  const sig = req.headers.get("tiktok-signature") ?? "";
  if (!secret || !verifySignature(rawBody, sig, secret)) {
    // Untrusted delivery: don't process, but 200 so TikTok stops retrying it.
    return NextResponse.json({ ok: false });
  }

  let payload: {
    event?: string;
    user_openid?: string;
    content?: string;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }
  if (payload.event !== "comment.update" || !payload.user_openid) {
    return NextResponse.json({ ok: true });
  }

  let content: {
    comment_id?: string | number;
    video_id?: string | number;
    parent_comment_id?: string | number;
    comment_type?: string;
    comment_action?: string;
  };
  try {
    content = JSON.parse(payload.content ?? "{}");
  } catch {
    return NextResponse.json({ ok: true });
  }
  const commentId = String(content.comment_id ?? "");
  const videoId = String(content.video_id ?? "");
  const action = String(content.comment_action ?? "");
  if (!commentId || !action) return NextResponse.json({ ok: true });

  const db = supabaseAdmin();
  const businessId = String(payload.user_openid);
  // Every connection that holds this account (same account can live in more
  // than one workspace — each reflects the change in its own inbox).
  const { data: rows } = await db
    .from("channel_connections")
    .select("*")
    .eq("channel", "tiktok_comment")
    .in("status", ["connected", "error", "expired"]);
  const conns = ((rows ?? []) as ChannelConnection[]).filter(
    (c) => String((c.config as Record<string, unknown> | null)?.business_id ?? "") === businessId,
  );
  if (conns.length === 0) return NextResponse.json({ ok: true });

  for (const conn of conns) {
    try {
      await applyToConnection(db, conn, { commentId, videoId, action, content });
    } catch (err) {
      console.error("[tiktok/webhook] apply failed:", err);
    }
  }
  return NextResponse.json({ ok: true });
}

async function applyToConnection(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  ev: {
    commentId: string;
    videoId: string;
    action: string;
    content: { parent_comment_id?: string | number };
  },
): Promise<void> {
  const workspaceId = conn.workspace_id;
  // Localizar el mensaje ya guardado de este comentario en ESTE workspace.
  const { data: existing } = await db
    .from("messages")
    .select("id, is_hidden, conversation_id, conversations!inner(workspace_id)")
    .eq("message_id", ev.commentId)
    .eq("channel", "tiktok_comment")
    .eq("conversations.workspace_id", workspaceId)
    .maybeSingle();

  if (ev.action === "delete") {
    if (existing) {
      await db
        .from("messages")
        .update({ status: "failed", content_text: COMMENT_DELETED_TEXT })
        .eq("id", (existing as { id: string }).id);
    }
    return;
  }
  if (ev.action === "set_to_hidden" || ev.action === "set_to_friends_only") {
    if (existing) {
      await db.from("messages").update({ is_hidden: true }).eq("id", (existing as { id: string }).id);
    }
    return;
  }
  if (ev.action === "set_to_public") {
    if (existing) {
      await db.from("messages").update({ is_hidden: false }).eq("id", (existing as { id: string }).id);
    }
    return;
  }
  if (ev.action === "insert") {
    // Nuevo comentario: si ya existe (el poll lo trajo) no hay nada que hacer.
    if (existing) return;
    await ingestFreshComment(db, conn, ev.commentId, ev.videoId, ev.content.parent_comment_id);
  }
}

/** Trae el texto/autor del comentario recién creado y lo ingiere (instantáneo,
 *  sin esperar al poll). Idempotente por message_id. */
async function ingestFreshComment(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ChannelConnection,
  commentId: string,
  videoId: string,
  parentCommentId: string | number | undefined,
): Promise<void> {
  const cfg = (conn.config ?? {}) as Record<string, unknown>;
  const businessId = String(cfg.business_id ?? "");
  if (!businessId || !videoId) return;
  let token: string;
  try {
    token = await getFreshTikTokToken(conn);
  } catch {
    return; // el poll lo recuperará
  }
  const url =
    `${TT}/business/comment/list/?business_id=${encodeURIComponent(businessId)}` +
    `&video_id=${encodeURIComponent(videoId)}&max_count=30`;
  const r = await fetch(url, { headers: { "Access-Token": token } });
  const j = (await r.json().catch(() => ({}))) as {
    code?: number;
    data?: { comments?: Array<Record<string, unknown>> };
  };
  if (!r.ok || (j.code ?? 0) !== 0) return;
  const c = (j.data?.comments ?? []).find(
    (x) => String(x.comment_id ?? x.id ?? "") === commentId,
  );
  if (!c) return;
  const text = String(c.text ?? "");
  if (!text) return;
  if (c.owner === true || String(c.user_id ?? "") === businessId) return;
  const username = String(c.username ?? c.user_name ?? "");
  const created = c.create_time
    ? new Date(Number(c.create_time) * 1000).toISOString()
    : new Date().toISOString();
  await ingestInboundEvent(db, {
    channel: "tiktok_comment",
    connection: conn,
    externalContactId: String(c.user_id ?? username ?? "tiktok"),
    contactName: String(c.display_name ?? username ?? "") || undefined,
    externalMessageId: commentId,
    externalThreadId: `video:${videoId}|comment:${String(parentCommentId ?? commentId)}`,
    text,
    comment: {
      postId: videoId,
      parentCommentId: parentCommentId ? String(parentCommentId) : undefined,
    },
    receivedAt: created,
    raw: c,
  });
}

/** Verifica `TikTok-Signature: t=<unix>,s=<hmac>`. HMAC-SHA256 de `${t}.${body}`
 *  con el app secret (hex). Rechaza timestamps de más de 10 min (anti-replay). */
function verifySignature(rawBody: string, header: string, secret: string): boolean {
  if (!header) return false;
  const parts: Record<string, string> = {};
  for (const seg of header.split(",")) {
    const [k, v] = seg.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  }
  const t = parts.t;
  const s = parts.s;
  if (!t || !s) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(s);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const ageSec = Math.abs(Date.now() / 1000 - Number(t));
  return Number.isFinite(ageSec) && ageSec < 600;
}
