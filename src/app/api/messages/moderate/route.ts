import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { decrypt } from "@/lib/channels/encryption";
import { appsecretProof, withAppsecretProof } from "@/lib/channels/meta-graph";
import { COMMENT_DELETED_TEXT } from "@/lib/channels/display";
import { describeMetaSendError, parseMetaError } from "@/lib/channels/meta-errors";
import { getFreshTikTokToken } from "@/lib/channels/tiktok_comment/adapter";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { ChannelConnection, Conversation, Message } from "@/types";

type Action = "hide" | "unhide" | "delete" | "like" | "unlike";

/**
 * POST /api/messages/moderate
 * Body: { message_id: string; action: 'hide' | 'unhide' | 'delete' | 'like' | 'unlike' }
 *
 * Applies a moderation action to a FB / IG comment via the Graph API.
 * Mirrors the buttons in business.facebook.com's comment-moderation UI.
 */
export async function POST(req: Request): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, "errInbox.unauthorized") },
      { status: 401 },
    );

  const body = (await req.json().catch(() => null)) as
    | { message_id?: string; action?: Action }
    | null;
  if (!body?.message_id || !body.action) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.moderateMissingFields") },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: message } = await admin
    .from("messages")
    .select("*")
    .eq("id", body.message_id)
    .maybeSingle();
  if (!message) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.messageNotFound") },
      { status: 404 },
    );
  }
  const m = message as Message;
  if (
    m.channel !== "fb_comment" &&
    m.channel !== "ig_comment" &&
    m.channel !== "tiktok_comment"
  ) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.moderateOnlyComments") },
      { status: 400 },
    );
  }
  if (!m.message_id) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.commentNoExternalId") },
      { status: 409 },
    );
  }

  const { data: conv } = await admin
    .from("conversations")
    .select("*")
    .eq("id", m.conversation_id)
    .maybeSingle();
  if (!conv)
    return NextResponse.json(
      { error: translate(locale, "errInbox.conversationNotFound") },
      { status: 404 },
    );

  // Authorization — admin of the workspace can moderate.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", (conv as Conversation).workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || (membership as { role: string }).role !== "admin") {
    return NextResponse.json(
      { error: translate(locale, "errInbox.adminOnly") },
      { status: 403 },
    );
  }

  // Prefer the comment's OWN owning connection (migration 117): a commenter who
  // hit two of the workspace's accounts collapses into one conversation owned by
  // the first, so the conversation's connection can be the wrong account — its
  // page token would fail to moderate a comment that belongs to the other.
  const { data: cmeta } = await admin
    .from("comments_meta")
    .select("connection_id")
    .eq("message_id", m.id)
    .maybeSingle();
  const owningConnectionId =
    (cmeta as { connection_id?: string | null } | null)?.connection_id ??
    (conv as Conversation).connection_id ??
    "";
  const { data: connection } = await admin
    .from("channel_connections")
    .select("*")
    .eq("id", owningConnectionId)
    .maybeSingle();
  if (!connection)
    return NextResponse.json(
      { error: translate(locale, "errInbox.connectionNotFound") },
      { status: 404 },
    );
  const conn = connection as ChannelConnection;
  const commentId = m.message_id;
  const action = body.action;

  let result: { ok: boolean; detail?: string };
  if (m.channel === "tiktok_comment") {
    // TikTok: la conversación guarda "video:<id>|comment:<top>"; el hide/delete
    // necesitan el video_id y el business_id de la conexión.
    const cfg = (conn.config ?? {}) as Record<string, unknown>;
    const businessId = String(cfg.business_id ?? "");
    const thread = String((conv as Conversation).thread_external_id ?? "");
    const videoId = thread.startsWith("video:") ? thread.slice(6).split("|")[0] : "";
    result = await applyTikTokAction(conn, businessId, videoId, commentId, action);
  } else {
    const secrets = (conn.secrets ?? {}) as Record<string, unknown>;
    const accessToken = decrypt(String(secrets.access_token ?? ""));
    result = await applyGraphAction(m.channel, commentId, action, accessToken);
  }
  if (!result.ok) {
    // Map Meta's raw JSON to a clean, localized message (e.g. "permission not
    // approved") instead of dumping the Graph error body into the toast.
    const parsed = parseMetaError(result.detail ?? "");
    const message = parsed
      ? describeMetaSendError(
          m.channel === "tiktok_comment" ? "ig_comment" : m.channel,
          502,
          parsed,
          locale,
        ).userMessage
      : (result.detail ?? translate(locale, "errInbox.graphCallFailed"));
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Local bookkeeping.
  if (action === "delete") {
    await admin.from("messages").update({ status: "failed", content_text: COMMENT_DELETED_TEXT }).eq("id", m.id);
  }
  if (action === "hide" || action === "unhide") {
    // Persist the hidden state so it survives reloads and syncs across panes
    // (messages is in the realtime publication → the UPDATE propagates). Best
    // effort: if migration 095 isn't applied yet the column is missing and the
    // update errors — don't fail the request, the Graph action already worked.
    const { error: updErr } = await admin
      .from("messages")
      .update({ is_hidden: action === "hide" })
      .eq("id", m.id);
    if (updErr) console.warn("[moderate] persist is_hidden failed:", updErr.message);
  }

  return NextResponse.json({ ok: true });
}

const TT_API = "https://business-api.tiktok.com/open_api/v1.3";

/**
 * Modera un comentario de TikTok (Accounts API). Endpoints y valores del
 * parámetro `action` exactos según la doc oficial (mayúsculas):
 *   hide/unhide → /business/comment/hide/  action=HIDE|UNHIDE (+video_id)
 *   like/unlike → /business/comment/like/  action=LIKE|UNLIKE
 *   delete      → /business/comment/delete/ (sin action)
 * Todos requieren business_id + comment_id; hide además el video_id.
 */
async function applyTikTokAction(
  connection: ChannelConnection,
  businessId: string,
  videoId: string,
  commentId: string,
  action: Action,
): Promise<{ ok: boolean; detail?: string }> {
  if (!businessId || !commentId) return { ok: false, detail: "missing business_id/comment_id" };
  let token: string;
  try {
    token = await getFreshTikTokToken(connection);
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "token error" };
  }
  const headers = { "Access-Token": token, "content-type": "application/json" };

  const call = async (path: string, payload: Record<string, unknown>) => {
    const r = await fetch(`${TT_API}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string };
    if (!r.ok || (j.code ?? 0) !== 0) {
      return { ok: false, detail: `TikTok ${j.code ?? r.status}: ${j.message ?? ""}` };
    }
    return { ok: true };
  };

  const base = { business_id: businessId, comment_id: commentId };
  switch (action) {
    case "hide":
      return call("/business/comment/hide/", { ...base, video_id: videoId, action: "HIDE" });
    case "unhide":
      return call("/business/comment/hide/", { ...base, video_id: videoId, action: "UNHIDE" });
    case "like":
      return call("/business/comment/like/", { ...base, action: "LIKE" });
    case "unlike":
      return call("/business/comment/like/", { ...base, action: "UNLIKE" });
    case "delete":
      return call("/business/comment/delete/", base);
    default:
      return { ok: false, detail: "unknown action" };
  }
}

async function applyGraphAction(
  channel: "fb_comment" | "ig_comment",
  commentId: string,
  action: Action,
  accessToken: string,
): Promise<{ ok: boolean; detail?: string }> {
  const GRAPH = "https://graph.facebook.com/v21.0";
  // Graph's reply shape varies by action/version — {"success":true}, the
  // updated object, or a bare `true`. So DON'T require a specific success flag
  // (that wrongly rejected valid Facebook hides). A non-2xx or a body carrying
  // an explicit `error` is a failure; any other 2xx means the write applied.
  const finish = async (r: Response): Promise<{ ok: boolean; detail?: string }> => {
    const text = await r.text().catch(() => "");
    if (!r.ok) return { ok: false, detail: text };
    try {
      const json = JSON.parse(text) as unknown;
      if (
        json &&
        typeof json === "object" &&
        (json as { error?: unknown }).error
      ) {
        return { ok: false, detail: text };
      }
    } catch {
      /* non-JSON 2xx (e.g. a bare `true`) — treat as success */
    }
    return { ok: true };
  };
  try {
    if (action === "delete") {
      const r = await fetch(
        withAppsecretProof(
          `${GRAPH}/${commentId}?access_token=${encodeURIComponent(accessToken)}`,
          accessToken,
        ),
        { method: "DELETE" },
      );
      return finish(r);
    }
    if (action === "hide" || action === "unhide") {
      // Facebook comments hide via `is_hidden`; Instagram comments via `hide`
      // (a DIFFERENT field — sending is_hidden to an IG comment is ignored).
      const value = action === "hide" ? "true" : "false";
      const body = new URLSearchParams(
        channel === "ig_comment" ? { hide: value } : { is_hidden: value },
      );
      body.set("access_token", accessToken);
      const proof = appsecretProof(accessToken);
      if (proof) body.set("appsecret_proof", proof);
      const r = await fetch(`${GRAPH}/${commentId}`, { method: "POST", body });
      return finish(r);
    }
    if (action === "like") {
      const r = await fetch(
        withAppsecretProof(
          `${GRAPH}/${commentId}/likes?access_token=${encodeURIComponent(accessToken)}`,
          accessToken,
        ),
        { method: "POST" },
      );
      return finish(r);
    }
    if (action === "unlike") {
      const r = await fetch(
        withAppsecretProof(
          `${GRAPH}/${commentId}/likes?access_token=${encodeURIComponent(accessToken)}`,
          accessToken,
        ),
        { method: "DELETE" },
      );
      return finish(r);
    }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "unknown error" };
  }
  return { ok: false, detail: "unknown action" };
}
