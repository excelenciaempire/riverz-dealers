import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/channels/registry";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
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
    | {
        conversation_id?: string;
        text?: string;
        reply_to_external_id?: string;
        template_name?: string;
        template_language?: string;
        template_params?: string[];
        media?: {
          url?: string;
          mediaType?: string;
          mime?: string;
          filename?: string;
          name?: string;
          size?: number;
        };
      }
    | null;
  // A media attachment can be sent with or without a caption (text).
  const media = body?.media?.url ? body.media : null;
  // A template send carries no free text: the body is rendered by Meta from
  // the approved template + positional params. `text` still arrives as the
  // rendered preview so the thread shows what the customer received.
  const templateName = body?.template_name?.trim() || null;
  if (!body?.conversation_id || (!body.text?.trim() && !media && !templateName)) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.sendMissingFields") },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();

  const { data: conversation } = await admin
    .from("conversations")
    .select("*")
    .eq("id", body.conversation_id)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.conversationNotFound") },
      { status: 404 },
    );
  }

  // Authorization: caller must be a member of the conversation's workspace.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", (conversation as Conversation).workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );
  }

  const { data: contact } = await admin
    .from("contacts")
    .select("*")
    .eq("id", (conversation as Conversation).contact_id)
    .maybeSingle();
  if (!contact) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.contactNotFound") },
      { status: 404 },
    );
  }

  const connectionId = (conversation as Conversation).connection_id;
  if (!connectionId) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.conversationNoConnection") },
      { status: 409 },
    );
  }
  const { data: connection } = await admin
    .from("channel_connections")
    .select("*")
    .eq("id", connectionId)
    .maybeSingle();
  if (!connection) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.connectionNotFound") },
      { status: 404 },
    );
  }

  const channel = (conversation as Conversation).channel;
  // Outbound media: normalize the upload category to a WhatsApp send type +
  // the messages.content_type CHECK set (voice→audio, sticker→image).
  const mediaSendType: "image" | "video" | "audio" | "document" | null = media
    ? media.mediaType === "video"
      ? "video"
      : media.mediaType === "audio" || media.mediaType === "voice"
        ? "audio"
        : media.mediaType === "document"
          ? "document"
          : "image"
    : null;
  const contentType = templateName
    ? "template"
    : mediaSendType
    ? mediaSendType
    : channel === "gmail" || channel === "outlook"
      ? "email"
      : channel === "fb_comment" ||
          channel === "ig_comment" ||
          channel === "tiktok_comment"
        ? "comment"
        : "text";

  // Comment replies must target a COMMENT id, not the post id. The
  // conversation's thread_external_id is the post/media id (used for
  // grouping), so replying to that 400s ("object does not exist").
  // Resolve the reply target to the specific comment the agent picked,
  // or fall back to the most recent inbound comment in the thread.
  let replyToExternalId = body.reply_to_external_id;
  if (
    channel === "fb_comment" ||
    channel === "ig_comment" ||
    channel === "tiktok_comment"
  ) {
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
  const caption = body.text?.trim() || undefined;
  // Media fields shared by the failed + success inserts.
  const mediaFields = media
    ? {
        media_url: media.url,
        media_mime: media.mime,
        media_size: media.size,
        attachments: [
          { url: media.url, mime_type: media.mime, name: media.name, size: media.size },
        ],
      }
    : {};
  const contentText = media ? (caption ?? null) : body.text;
  const mediaEmoji =
    mediaSendType === "image"
      ? "🖼️"
      : mediaSendType === "video"
        ? "🎬"
        : mediaSendType === "audio"
          ? "🎤"
          : "📄";
  const lastText = media ? (caption ?? mediaEmoji) : (body.text ?? "");
  let result: {
    externalMessageId?: string;
    status?: string;
    heldForQuality?: boolean;
    waId?: string;
  };
  try {
    if (templateName) {
      if (!adapter.sendTemplate) {
        throw new Error(translate(locale, "errInbox.templateUnsupported"));
      }
      result = await adapter.sendTemplate({
        channel,
        connection: connection as ChannelConnection,
        conversation: conversation as Conversation,
        contact: contact as Contact,
        templateName,
        language: body.template_language,
        params: Array.isArray(body.template_params) ? body.template_params : [],
      });
    } else if (media && mediaSendType) {
      if (!adapter.sendMedia) {
        throw new Error(translate(locale, "errInbox.mediaUnsupported"));
      }
      result = await adapter.sendMedia({
        channel,
        connection: connection as ChannelConnection,
        conversation: conversation as Conversation,
        contact: contact as Contact,
        mediaUrl: media.url as string,
        mediaType: mediaSendType,
        caption,
        filename: media.filename || media.name,
        // NOTE: reply-context (Meta wamid) isn't wired for WhatsApp here — the
        // composer's replyTo is an internal UUID, not a wamid — so we don't
        // pass it as a media context id (would 400).
      });
    } else {
      result = await adapter.sendText({
        channel,
        connection: connection as ChannelConnection,
        conversation: conversation as Conversation,
        contact: contact as Contact,
        text: body.text as string,
        replyToExternalId,
        // This endpoint is only ever hit by an authenticated human agent typing
        // in the inbox — so Messenger/Instagram may fall back to the HUMAN_AGENT
        // tag (7-day window) when a reply lands outside Meta's 24h window.
        humanAgent: true,
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[send/${channel}] failed:`, detail);
    // Persistir el motivo del fallo síncrono (antes se guardaba 'failed' pelado
    // y la burbuja quedaba con una X sin explicación). error_code se extrae del
    // cuerpo crudo de Meta cuando viene; error_reason guarda el detalle.
    const codeMatch = /"code"\s*:\s*(\d+)/.exec(detail);
    const { data: failedMsg } = await admin
      .from("messages")
      .insert({
        conversation_id: (conversation as Conversation).id,
        channel,
        sender_type: "agent",
        sender_id: user.id,
        content_type: contentType,
        content_text: contentText,
        template_name: templateName,
        ...mediaFields,
        status: "failed",
        error_reason: detail.slice(0, 500),
        error_code: codeMatch ? Number(codeMatch[1]) : null,
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
      content_text: contentText,
      template_name: templateName,
      ...mediaFields,
      message_id: result.externalMessageId,
      status: result.status ?? "sent",
      // Retención por PACING (plantilla nueva/sin GREEN): la burbuja mostrará
      // "en revisión de calidad" en vez de un 'sent' mudo.
      held_for_quality: result.heldForQuality ?? false,
    })
    .select()
    .single();

  // Guardar el wa_id normalizado que devolvió Meta sobre el contacto (identidad
  // real; el "+54 9" argentino resuelve al mismo wa_id con o sin el 9).
  if (result.waId && (contact as Contact).id) {
    await admin
      .from("contacts")
      .update({ wa_id: result.waId })
      .eq("id", (contact as Contact).id)
      .is("wa_id", null);
  }

  // Ojo con el reloj: `last_message_at` debe ser el created_at REAL de la fila
  // recién insertada. Si se usa un new Date() tomado después, queda unos ms por
  // delante del mensaje y el trigger que mantiene el tick del preview
  // (migración 103) descarta cada update de estado posterior — el chat se
  // quedaba con una sola raya aunque Meta confirmara la entrega.
  const sentAt =
    ((message as Message | null)?.created_at as string | undefined) ??
    new Date().toISOString();
  await admin
    .from("conversations")
    .update({
      last_message_text: lastText.slice(0, 200),
      last_message_at: sentAt,
      last_sender_type: "agent",
      updated_at: sentAt,
    })
    .eq("id", (conversation as Conversation).id);

  return NextResponse.json({ ok: true, message: message as Message });
}
