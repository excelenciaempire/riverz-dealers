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

  const adapter = getAdapter((conversation as Conversation).channel);
  const result = await adapter.sendText({
    channel: (conversation as Conversation).channel,
    connection: connection as ChannelConnection,
    conversation: conversation as Conversation,
    contact: contact as Contact,
    text: body.text,
    replyToExternalId: body.reply_to_external_id,
  });

  // Persist outbound message + bump summary.
  const { data: message } = await admin
    .from("messages")
    .insert({
      conversation_id: (conversation as Conversation).id,
      channel: (conversation as Conversation).channel,
      sender_type: "agent",
      sender_id: user.id,
      content_type: ((conversation as Conversation).channel === "gmail" ||
                     (conversation as Conversation).channel === "outlook") ? "email" :
                    ((conversation as Conversation).channel === "fb_comment" ||
                     (conversation as Conversation).channel === "ig_comment") ? "comment" : "text",
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
