import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Channel,
  ChannelConnection,
  Contact,
  Conversation,
  Message,
} from "@/types";
import type { InboundEvent } from "./types";

/**
 * Persist an inbound channel event into the unified inbox: upsert the
 * contact, find-or-create the conversation, and insert the message.
 * Channel-agnostic — every adapter feeds its parsed events through
 * here so the inbox sees a consistent shape.
 *
 * Idempotent on `messages.message_id` — if the same external id has
 * already been ingested, this is a no-op (the unique index on
 * `messages.message_id` would otherwise raise 23505).
 */
export async function ingestInboundEvent(
  db: SupabaseClient,
  event: InboundEvent,
): Promise<{ contact: Contact; conversation: Conversation; message: Message } | null> {
  const workspaceId = event.connection.workspace_id;
  const channel: Channel = event.channel;

  // 1. Upsert contact by (workspace_id, channel, external_id).
  const contact = await upsertContact(db, {
    workspace_id: workspaceId,
    channel,
    external_id: event.externalContactId,
    name: event.contactName,
    avatar_url: event.contactAvatarUrl,
    email: channel === "gmail" || channel === "outlook" ? event.externalContactId : undefined,
    phone: channel === "whatsapp" ? event.externalContactId : undefined,
  });
  if (!contact) return null;

  // 2. Find-or-create conversation. Emails group by threadId; everything
  //    else keeps one open conversation per (contact, channel).
  const conversation = await findOrCreateConversation(db, {
    workspace_id: workspaceId,
    contact_id: contact.id,
    channel,
    connection_id: event.connection.id,
    subject: event.subject,
    thread_external_id: event.externalThreadId ?? event.comment?.postId ?? null,
  });
  if (!conversation) return null;

  // 3. Insert message — idempotent on external id.
  const insertPayload: Record<string, unknown> = {
    conversation_id: conversation.id,
    channel,
    // Sent-folder emails come back as outbound (we authored them), so
    // they land as agent messages on the right side of the thread.
    sender_type: event.outbound ? "agent" : "customer",
    content_type: channel === "gmail" || channel === "outlook" ? "email" :
                  channel === "fb_comment" || channel === "ig_comment" ? "comment" : "text",
    content_text: event.text,
    html_body: event.htmlBody,
    subject: event.subject,
    attachments: event.attachments ?? null,
    message_id: event.externalMessageId,
    status: event.outbound ? "sent" : "delivered",
    created_at: event.receivedAt,
  };
  const { data: message, error } = await db
    .from("messages")
    .insert(insertPayload)
    .select()
    .single();
  if (error) {
    // 23505 = unique_violation on message_id → already ingested.
    if (error.code === "23505") return null;
    console.error("[inbox-writer] insert message failed:", error);
    return null;
  }

  // 4. Comment metadata sidecar — and resolve ad_id by joining against
  //    the ad_posts cache (populated by the Marketing API sync cron).
  //    The webhook payload rarely carries ad_id directly; the cache is
  //    the authoritative source.
  if (event.comment && message) {
    let adId = event.comment.adId;
    // Meta sends ad_id directly in the webhook payload for comments
    // on ads — that's the authoritative signal, no Marketing API call
    // needed. The ad_posts table is a secondary cache for dark posts
    // (page-promotable creatives that don't appear in the page feed,
    // so the webhook can't tag them); we still consult it but its
    // absence is no longer a blocker for `is_ad`.
    let isAd = Boolean(adId);
    if (!isAd && event.comment.postId) {
      const { data: adPost } = await db
        .from("ad_posts")
        .select("ad_id")
        .eq("workspace_id", workspaceId)
        .eq("post_id", event.comment.postId)
        .maybeSingle();
      if (adPost) {
        isAd = true;
        if (adPost.ad_id) adId = adPost.ad_id;
      }
    }
    await db.from("comments_meta").insert({
      message_id: message.id,
      post_id: event.comment.postId,
      parent_comment_id: event.comment.parentCommentId,
      ad_id: adId,
      permalink: event.comment.permalink,
      is_ad: isAd,
    });

    // Bubble is_ad onto the conversation row so the inbox list can
    // show the "Anuncio" badge without a join on comments_meta.
    if (isAd) {
      await db
        .from("conversations")
        .update({ is_ad: true })
        .eq("id", conversation.id);
    }
  }

  // 5. Bump conversation summary fields. Outbound (our own sent mail)
  //    must not increment the unread counter.
  await db
    .from("conversations")
    .update({
      last_message_text: event.text.slice(0, 200),
      last_message_at: event.receivedAt,
      last_sender_type: event.outbound ? "agent" : "customer",
      unread_count: event.outbound
        ? (conversation.unread_count ?? 0)
        : (conversation.unread_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);

  return { contact, conversation, message: message as Message };
}

interface UpsertContactInput {
  workspace_id: string;
  channel: Channel;
  external_id: string;
  name?: string;
  avatar_url?: string;
  email?: string;
  phone?: string;
}

async function upsertContact(
  db: SupabaseClient,
  input: UpsertContactInput,
): Promise<Contact | null> {
  // We rely on the (workspace_id, channel, external_id) unique index
  // created in migration 013 (`uq_contact_identity`).
  const { data: existing } = await db
    .from("contacts")
    .select("*")
    .eq("workspace_id", input.workspace_id)
    .eq("channel", input.channel)
    .eq("external_id", input.external_id)
    .maybeSingle();
  if (existing) return existing as Contact;

  const { data: created, error } = await db
    .from("contacts")
    .insert({
      workspace_id: input.workspace_id,
      channel: input.channel,
      external_id: input.external_id,
      name: input.name,
      avatar_url: input.avatar_url,
      email: input.email,
      phone: input.phone,
    })
    .select()
    .single();
  if (error) {
    console.error("[inbox-writer] upsert contact failed:", error);
    return null;
  }
  return created as Contact;
}

interface FindOrCreateConversationInput {
  workspace_id: string;
  contact_id: string;
  channel: Channel;
  connection_id: string;
  subject?: string;
  thread_external_id: string | null;
}

async function findOrCreateConversation(
  db: SupabaseClient,
  input: FindOrCreateConversationInput,
): Promise<Conversation | null> {
  // Email channels: group by thread_external_id.
  // Everything else: one open conversation per (contact, channel).
  let query = db
    .from("conversations")
    .select("*")
    .eq("workspace_id", input.workspace_id)
    .eq("contact_id", input.contact_id)
    .eq("channel", input.channel);
  if (input.thread_external_id && (input.channel === "gmail" || input.channel === "outlook")) {
    query = query.eq("thread_external_id", input.thread_external_id);
  } else {
    query = query.neq("status", "closed");
  }
  const { data: existing } = await query.limit(1).maybeSingle();
  if (existing) return existing as Conversation;

  const { data: created, error } = await db
    .from("conversations")
    .insert({
      workspace_id: input.workspace_id,
      contact_id: input.contact_id,
      channel: input.channel,
      connection_id: input.connection_id,
      subject: input.subject,
      thread_external_id: input.thread_external_id,
      status: "open",
      unread_count: 0,
    })
    .select()
    .single();
  if (error) {
    console.error("[inbox-writer] create conversation failed:", error);
    return null;
  }
  return created as Conversation;
}
