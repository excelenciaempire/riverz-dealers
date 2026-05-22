import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { message_id?: string; action?: Action }
    | null;
  if (!body?.message_id || !body.action) {
    return NextResponse.json({ error: "message_id + action required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: message } = await admin
    .from("messages")
    .select("*")
    .eq("id", body.message_id)
    .maybeSingle();
  if (!message) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }
  const m = message as Message;
  if (m.channel !== "fb_comment" && m.channel !== "ig_comment") {
    return NextResponse.json({ error: "moderation only valid on FB/IG comments" }, { status: 400 });
  }
  if (!m.message_id) {
    return NextResponse.json({ error: "comment has no external id" }, { status: 409 });
  }

  const { data: conv } = await admin
    .from("conversations")
    .select("*")
    .eq("id", m.conversation_id)
    .maybeSingle();
  if (!conv) return NextResponse.json({ error: "conversation not found" }, { status: 404 });

  // Authorization — admin of the workspace can moderate.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", (conv as Conversation).workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || (membership as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const { data: connection } = await admin
    .from("channel_connections")
    .select("*")
    .eq("id", (conv as Conversation).connection_id ?? "")
    .maybeSingle();
  if (!connection) return NextResponse.json({ error: "connection not found" }, { status: 404 });
  const secrets = ((connection as ChannelConnection).secrets ?? {}) as Record<string, unknown>;
  const accessToken = decrypt(String(secrets.access_token ?? ""));

  const commentId = m.message_id;
  const action = body.action;
  const result = await applyGraphAction(commentId, action, accessToken);
  if (!result.ok) {
    return NextResponse.json({ error: result.detail ?? "graph call failed" }, { status: 502 });
  }

  // Local bookkeeping — flip status when deleted, store a tag/annotation for hidden.
  if (action === "delete") {
    await admin.from("messages").update({ status: "failed", content_text: "[deleted]" }).eq("id", m.id);
  }

  return NextResponse.json({ ok: true });
}

async function applyGraphAction(
  commentId: string,
  action: Action,
  accessToken: string,
): Promise<{ ok: boolean; detail?: string }> {
  const GRAPH = "https://graph.facebook.com/v21.0";
  try {
    if (action === "delete") {
      const r = await fetch(`${GRAPH}/${commentId}?access_token=${encodeURIComponent(accessToken)}`, {
        method: "DELETE",
      });
      if (!r.ok) return { ok: false, detail: await r.text() };
      return { ok: true };
    }
    if (action === "hide" || action === "unhide") {
      const body = new URLSearchParams({
        is_hidden: action === "hide" ? "true" : "false",
        access_token: accessToken,
      });
      const r = await fetch(`${GRAPH}/${commentId}`, { method: "POST", body });
      if (!r.ok) return { ok: false, detail: await r.text() };
      return { ok: true };
    }
    if (action === "like") {
      const r = await fetch(
        `${GRAPH}/${commentId}/likes?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST" },
      );
      if (!r.ok) return { ok: false, detail: await r.text() };
      return { ok: true };
    }
    if (action === "unlike") {
      const r = await fetch(
        `${GRAPH}/${commentId}/likes?access_token=${encodeURIComponent(accessToken)}`,
        { method: "DELETE" },
      );
      if (!r.ok) return { ok: false, detail: await r.text() };
      return { ok: true };
    }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "unknown error" };
  }
  return { ok: false, detail: "unknown action" };
}
