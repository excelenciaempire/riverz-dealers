import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Channel,
  Contact,
  Conversation,
  Message,
} from "@/types";
import type { InboundEvent } from "./types";
import { runAiAgent } from "@/lib/ai/runner";
import { linkUnifiedContact } from "@/lib/contacts/dedupe";
import { resolveAssignmentForConversation } from "@/lib/inbox/assignment-rules";
import { mimeToCategory } from "./media-ingest";
import {
  maybeInstantOutreach,
  maybeRunCloser,
} from "@/lib/instagram-agent/realtime";

/**
 * Persist an inbound channel event into the unified inbox: upsert the
 * contact, find-or-create the conversation, and insert the message.
 * Channel-agnostic — every adapter feeds its parsed events through
 * here so the inbox sees a consistent shape.
 *
 * Idempotent on `(conversation_id, message_id)` — if the same external
 * id has already been ingested into this conversation, this is a no-op
 * (the `uniq_msg_per_conv` unique index on (conversation_id, message_id)
 * from migration 036 would otherwise raise 23505).
 */
export async function ingestInboundEvent(
  db: SupabaseClient,
  event: InboundEvent,
): Promise<{ contact: Contact; conversation: Conversation; message: Message } | null> {
  const workspaceId = event.connection.workspace_id;
  const channel: Channel = event.channel;

  // 0. Never ingest the business's OWN account as a customer. Meta sends
  //    echo webhooks for messages we send (sender = our own page/IG id)
  //    and fires comment webhooks when the page comments on its own posts;
  //    ingesting those makes the account its own "customer" and inflates
  //    every tenant's metrics. This is the single chokepoint that protects
  //    EVERY channel + EVERY connected workspace (each connection carries
  //    its own ids), so it holds even if a future adapter forgets to
  //    filter. Outbound events (event.outbound) key on the recipient, not
  //    us, so they pass through untouched.
  const connCfg = (event.connection.config ?? {}) as Record<string, unknown>;
  const ownAccountIds = new Set(
    [event.connection.external_account_id, connCfg.page_id, connCfg.ig_user_id]
      .map((v) => (v == null ? "" : String(v)))
      .filter(Boolean),
  );
  if (!event.outbound && ownAccountIds.has(String(event.externalContactId))) {
    return null;
  }

  // 0b. Idempotencia GLOBAL por id externo de mensaje. El índice único
  //     `uniq_msg_per_conv` es por (conversation_id, message_id), así que NO
  //     cubre el caso de un polling de email que, tras borrar la conversación
  //     de la bandeja, vuelve a traer el mismo correo: crearía una conversación
  //     nueva y lo re-insertaría (otro conversation_id → el índice no choca).
  //     Con el soft-delete (migración 085) la fila del mensaje se conserva, así
  //     que aquí basta con ver si ese message_id ya existe en el workspace
  //     (en cualquier conversación, viva o borrada) y, si existe, no re-ingerir.
  if (event.externalMessageId) {
    const { data: already } = await db
      .from("messages")
      .select("id, conversations!inner(workspace_id)")
      .eq("message_id", event.externalMessageId)
      .eq("conversations.workspace_id", workspaceId)
      .limit(1)
      .maybeSingle();
    if (already) return null;
  }

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

  // 1b. Cross-channel dedupe (migration 050). Si este contact comparte
  //     teléfono normalizado o email con otro del mismo workspace, lo
  //     enlazamos al "primario" (el más viejo del grupo). El runner de
  //     IA después lee ai_summary + shopify_customer_data desde el
  //     primario. Fail-soft — no rompe el ingest si falla.
  await linkUnifiedContact(db, contact).catch(() => contact.id);

  // 2. Find-or-create conversation. Emails group by threadId; everything
  //    else keeps one open conversation per (contact, channel).
  const conversation = await findOrCreateConversation(db, {
    workspace_id: workspaceId,
    contact_id: contact.id,
    channel,
    connection_id: event.connection.id,
    subject: event.subject,
    thread_external_id: event.externalThreadId ?? event.comment?.postId ?? null,
    firstMessageText: event.text,
    lastMessageAt: event.receivedAt,
    lastSenderType: event.outbound ? "agent" : "customer",
  });
  if (!conversation) return null;

  // 3. Insert message — idempotent on external id.
  // Si el adapter trajo media, derivamos las columnas estructuradas
  // (media_type/media_mime/media_size/media_url) desde el primer
  // attachment. El JSONB `attachments` queda como historial completo
  // (cuando un mensaje ship múltiples archivos, sólo el primero llena
  // las columnas estructuradas — el resto sigue accesible vía JSONB).
  const firstAttachment = event.attachments?.[0];
  const baseContentType: string =
    channel === "gmail" || channel === "outlook"
      ? "email"
      : channel === "fb_comment" || channel === "ig_comment"
        ? "comment"
        : "text";
  let contentType = baseContentType;
  let mediaUrl: string | null = null;
  let mediaType: string | null = null;
  let mediaMime: string | null = null;
  let mediaSize: number | null = null;
  if (firstAttachment && firstAttachment.url) {
    mediaUrl = firstAttachment.url;
    mediaMime = firstAttachment.mime_type ?? null;
    mediaSize = firstAttachment.size ?? null;
    mediaType = mediaMime ? mimeToCategory(mediaMime) : null;
    // Si todavía estamos en texto pero hay media, bumpeamos el
    // content_type para que el inbox y los filtros sepan que hay
    // adjunto. Email/comment mantienen su tipo de alto nivel.
    if (baseContentType === "text" && mediaType) {
      contentType =
        mediaType === "voice"
          ? "audio"
          : mediaType === "sticker"
            ? "image"
            : mediaType;
    }
  }
  const insertPayload: Record<string, unknown> = {
    conversation_id: conversation.id,
    channel,
    // Sent-folder emails come back as outbound (we authored them), so
    // they land as agent messages on the right side of the thread.
    sender_type: event.outbound ? "agent" : "customer",
    content_type: contentType,
    content_text: event.text,
    html_body: event.htmlBody,
    subject: event.subject,
    attachments: event.attachments ?? null,
    media_url: mediaUrl,
    media_type: mediaType,
    media_mime: mediaMime,
    media_size: mediaSize,
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
    // 23505 = unique_violation on (conversation_id, message_id) via
    //         uniq_msg_per_conv → already ingested into this conversation.
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

  // Real-time outreach: an Instagram comment is peak intent. Enroll the
  // commenter in the active campaign and DM them now (Blueberry's instant
  // loop). Fire-and-forget; no active campaign → no-op.
  if (channel === "ig_comment" && !event.outbound) {
    maybeInstantOutreach(db, {
      workspaceId,
      contact: {
        id: contact.id,
        external_id: contact.external_id ?? null,
        name: contact.name ?? null,
      },
      sourcePostId: event.comment?.postId ?? null,
      // The comment id — lets us DM as a private reply to the comment.
      commentId: event.externalMessageId ?? null,
      engagementText: event.text,
    }).catch((err) =>
      console.error("[ig-agent] instant outreach failed:", err),
    );
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

  // Fire the AI customer-service agent for inbound (customer) text
  // messages. Comments are skipped — the AI flow only owns 1:1 chat
  // surfaces (DMs and email). Fire-and-forget so a slow LLM call
  // never blocks the webhook response.
  if (!event.outbound && channel !== "fb_comment" && channel !== "ig_comment") {
    const dispatchGeneric = () =>
      runAiAgent(db, {
        workspaceId,
        channel,
        conversation,
        contact,
        connection: event.connection,
        inboundMessage: message as Message,
      }).catch((err) => console.error("[ai] dispatch failed:", err));

    if (channel === "instagram") {
      // If this DM is a reply from a live campaign recipient, the campaign
      // closer answers in-context (their offer, code, brand voice) and we
      // suppress the generic assistant so they don't both reply. Otherwise
      // fall through to the normal customer-service agent.
      maybeRunCloser(db, {
        workspaceId,
        contact: {
          id: contact.id,
          external_id: contact.external_id ?? null,
          name: contact.name ?? null,
        },
        connection: event.connection,
        inboundText: event.text,
      })
        .then((handled) => {
          if (!handled) dispatchGeneric();
        })
        .catch(() => dispatchGeneric());
    } else {
      dispatchGeneric();
    }
  }

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
  if (existing) {
    // Backfill the display name / avatar once the channel resolves them.
    // Meta DMs (Messenger/Instagram) and comment channels ship only an
    // opaque id on the first event and the friendly name arrives on a
    // later one (or a best-effort Graph lookup that 429'd the first
    // time). Without this, a contact created id-only stays id-only
    // forever and the inbox keeps showing "Cliente Instagram · …1234".
    // Mirrors the legacy WhatsApp webhook, which already updates the
    // name when it changes. The name isn't user-editable in the UI, so
    // there's no agent-entered value to clobber.
    const e = existing as Contact;
    const patch: Record<string, string> = {};
    if (input.name && input.name !== e.name) patch.name = input.name;
    if (input.avatar_url && input.avatar_url !== e.avatar_url) {
      patch.avatar_url = input.avatar_url;
    }
    if (Object.keys(patch).length === 0) return e;
    const { data: updated } = await db
      .from("contacts")
      .update(patch)
      .eq("id", e.id)
      .select()
      .single();
    return (updated as Contact) ?? e;
  }

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
  /** Inbound text — feeds the by_keyword assignment rule AND seeds the
   *  conversation's last_message_text so a NEW conversation shows its
   *  preview immediately instead of flashing "No messages" until step 5's
   *  update lands. */
  firstMessageText?: string;
  /** Timestamp + sender of the first message, so a new conversation sorts +
   *  previews correctly the instant it's created. */
  lastMessageAt?: string;
  lastSenderType?: "agent" | "customer";
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
    .eq("channel", input.channel)
    // No reutilizar una conversación borrada de la bandeja (soft-delete): si
    // el contacto vuelve a escribir, arranca un hilo nuevo en vez de revivir
    // el borrado. (El re-polleo del MISMO correo ya se cortó en el paso 0b.)
    .is("deleted_at", null);
  if (input.thread_external_id && (input.channel === "gmail" || input.channel === "outlook")) {
    query = query.eq("thread_external_id", input.thread_external_id);
  } else {
    query = query.neq("status", "closed");
  }
  const { data: existing } = await query.limit(1).maybeSingle();
  if (existing) return existing as Conversation;

  // Run assignment rules so non-WhatsApp inbound (IG/Messenger/email/
  // comments) auto-assigns to an agent, same as the legacy WhatsApp
  // path. Best-effort — a failure just leaves it unassigned.
  let assignedAgentId: string | null = null;
  try {
    assignedAgentId = await resolveAssignmentForConversation(db, {
      workspaceId: input.workspace_id,
      conversationId: "",
      channel: input.channel,
      contactId: input.contact_id,
      firstMessageText: input.firstMessageText ?? "",
    });
  } catch (err) {
    console.error("[inbox-writer] assignment rules failed:", err);
  }

  const { data: created, error } = await db
    .from("conversations")
    .insert({
      workspace_id: input.workspace_id,
      contact_id: input.contact_id,
      channel: input.channel,
      connection_id: input.connection_id,
      subject: input.subject,
      thread_external_id: input.thread_external_id,
      assigned_agent_id: assignedAgentId,
      status: "open",
      // Seed the preview + sort fields so the conversation shows its last
      // message the instant it appears (no "No messages" flash). unread_count
      // stays 0 here — step 5 in ingestInboundEvent bumps it to 1 so we don't
      // double-count.
      last_message_text: input.firstMessageText
        ? input.firstMessageText.slice(0, 200)
        : null,
      last_message_at: input.lastMessageAt ?? new Date().toISOString(),
      last_sender_type: input.lastSenderType ?? "customer",
      unread_count: 0,
    })
    .select()
    .single();
  if (error) {
    // Race-safe: two concurrent webhook deliveries can both pass the
    // initial SELECT (no rows) and both attempt to INSERT. Migration
    // 035 installed `uniq_conv_per_thread`
    //   (workspace_id, contact_id, channel, COALESCE(thread_external_id,''))
    // so the second INSERT raises 23505 and used to drop the message
    // silently. Re-SELECT the winner. We don't filter by status here
    // because the unique index ignores status — without dropping that
    // filter we'd re-create a NEW conversation if the only existing
    // one is closed (then double-insert next time).
    if ((error as { code?: string }).code === "23505") {
      let recover = db
        .from("conversations")
        .select("*")
        .eq("workspace_id", input.workspace_id)
        .eq("contact_id", input.contact_id)
        .eq("channel", input.channel)
        .is("deleted_at", null);
      if (
        input.thread_external_id &&
        (input.channel === "gmail" || input.channel === "outlook")
      ) {
        recover = recover.eq("thread_external_id", input.thread_external_id);
      } else {
        recover = recover.is("thread_external_id", null);
      }
      const { data: winner } = await recover.limit(1).maybeSingle();
      if (winner) return winner as Conversation;
    }
    console.error("[inbox-writer] create conversation failed:", error);
    return null;
  }
  return created as Conversation;
}
