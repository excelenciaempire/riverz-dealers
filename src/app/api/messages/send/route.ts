import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/channels/registry";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import type { ChannelConnection, Contact, Conversation, Message } from "@/types";

/**
 * Unified send endpoint. Resolves the conversation → contact → connection
 * → adapter chain and routes the outbound message through the right
 * channel.
 *
 * POST body:
 *   { conversation_id: string; text: string; reply_to_external_id?: string }
 */
export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { conversation_id?: string; text?: string; reply_to_external_id?: string }
    | null;
  if (!body?.conversation_id || !body.text?.trim()) {
    return NextResponse.json({ error: "conversation_id + text required" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data: conversation } = await admin
    .from("conversations")
    .select("*")
    .eq("id", body.conversation_id)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  }

  // Authorization: caller must be a member of the conversation's workspace.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", (conversation as Conversation).workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: contact } = await admin
    .from("contacts")
    .select("*")
    .eq("id", (conversation as Conversation).contact_id)
    .maybeSingle();
  if (!contact) {
    return NextResponse.json({ error: "contact not found" }, { status: 404 });
  }

  const connectionId = (conversation as Conversation).connection_id;
  if (!connectionId) {
    return NextResponse.json({ error: "conversation has no connection" }, { status: 409 });
  }
  const { data: connection } = await admin
    .from("channel_connections")
    .select("*")
    .eq("id", connectionId)
    .maybeSingle();
  if (!connection) {
    return NextResponse.json({ error: "connection not found" }, { status: 404 });
  }

  const channel = (conversation as Conversation).channel;
  const contentType =
    channel === "gmail" || channel === "outlook"
      ? "email"
      : channel === "fb_comment" || channel === "ig_comment"
        ? "comment"
        : "text";

  // Comment replies must target a COMMENT id, not the post id. The
  // conversation's thread_external_id is the post/media id (used for
  // grouping), so replying to that 400s ("object does not exist").
  // Resolve the reply target to the specific comment the agent picked,
  // or fall back to the most recent inbound comment in the thread.
  let replyToExternalId = body.reply_to_external_id;
  if (channel === "fb_comment" || channel === "ig_comment") {
    let target: string | undefined;
    if (body.reply_to_external_id) {
      const { data: picked } = await admin
        .from("messages")
        .select("message_id")
        .eq("id", body.reply_to_external_id)
        .maybeSingle();
      target = picked?.message_id ?? undefined;
    }
    if (!target) {
      const { data: lastInbound } = await admin
        .from("messages")
        .select("message_id")
        .eq("conversation_id", (conversation as Conversation).id)
        .eq("sender_type", "customer")
        .not("message_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      target = lastInbound?.message_id ?? undefined;
    }
    replyToExternalId = target;
  }

  // Send through the channel adapter. On failure we still persist the
  // agent's message with status="failed" so their typed text is never
  // lost — it shows in the thread with a failed indicator — and we
  // return the error detail so the composer can surface it instead of a
  // bare 500.
  const adapter = getAdapter(channel);
  let result: { externalMessageId?: string; status?: string };
  try {
    result = await adapter.sendText({
      channel,
      connection: connection as ChannelConnection,
      conversation: conversation as Conversation,
      contact: contact as Contact,
      text: body.text,
      replyToExternalId,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[send/${channel}] failed:`, detail);
    const { data: failedMsg } = await admin
      .from("messages")
      .insert({
        conversation_id: (conversation as Conversation).id,
        channel,
        sender_type: "agent",
        sender_id: user.id,
        content_type: contentType,
        content_text: body.text,
        status: "failed",
      })
      .select()
      .single();
    return NextResponse.json(
      { ok: false, error: detail, message: failedMsg as Message },
      { status: 502 },
    );
  }

  // Persist outbound message + bump summary.
  const { data: message } = await admin
    .from("messages")
    .insert({
      conversation_id: (conversation as Conversation).id,
      channel,
      sender_type: "agent",
      sender_id: user.id,
      content_type: contentType,
      content_text: body.text,
      message_id: result.externalMessageId,
      status: result.status ?? "sent",
    })
    .select()
    .single();

  await admin
    .from("conversations")
    .update({
      last_message_text: body.text.slice(0, 200),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", (conversation as Conversation).id);

  return NextResponse.json({ ok: true, message: message as Message });
}
