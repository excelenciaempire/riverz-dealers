import { resolveHumanAttention } from '@/lib/inbox/human-attention';
import { NextResponse, after } from "next/server";
import { enrichConversationEvidence } from '@/lib/ai/conversation-evidence';
import { motorApagado } from '@/lib/workspaces/motor';
import { puertaDeIa } from '@/lib/wallet/puerta';
import { createClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/channels/registry";
import {
  esCanalDeComentarios,
  esError,
  resolveCommentReplyTarget,
} from "@/lib/channels/comment-reply-target";
import { prepararTextoParaCanal } from "@/lib/marketing/enlaces-salientes";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { assertMediaWorkspace } from "@/lib/channels/media-url";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import type { Channel, ChannelConnection, Contact, Conversation, Message } from "@/types";
import { isButtonUrlVariable } from "@/lib/whatsapp/dynamic-links";
import { emitWebhook } from '@/lib/webhooks/outbound';
import { metaHumanReplyExpired } from '@/lib/channels/meta-window';
import {
  CHANNEL_DISCONNECTED_CODE,
  assertConnectionCanSend,
  isChannelDisconnectedError,
} from "@/lib/channels/send-guard";

/**
 * ¿La plantilla lleva un botón de enlace VARIABLE (carrito, seguimiento…)?
 *
 * Ese botón se llena con el link de ESE cliente, que solo conoce el disparador
 * de la automatización. Enviada a mano desde la bandeja, Meta la rechaza con
 * "(#131008) Required parameter is missing" y el comercio se queda con una
 * burbuja fallida sin explicación.
 */
async function templateNeedsDynamicLink(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  templateName: string,
): Promise<boolean> {
  const { data } = await admin
    .from("message_templates")
    .select("buttons")
    .eq("workspace_id", workspaceId)
    .eq("name", templateName);
  const rows = (data ?? []) as Array<{
    buttons?: Array<Record<string, unknown>> | null;
  }>;
  // Mismo criterio que el selector de plantillas de la bandeja: la marca del
  // editor (`url_variable`) o un {{n}} suelto en la URL.
  return rows.some((r) =>
    (r.buttons ?? []).some((b) => {
      if (String(b?.type ?? "").toUpperCase() !== "URL") return false;
      return (
        isButtonUrlVariable(b?.url_variable) ||
        /\{\{\s*\d+\s*\}\}/.test(String(b?.url ?? ""))
      );
    }),
  );
}

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
  const requestedTemplateName = body?.template_name?.trim() || null;
  if (!body?.conversation_id || (!body.text?.trim() && !media && !requestedTemplateName)) {
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

  if (media) {
    try {
      if (typeof media.url !== 'string') throw new Error('invalid_media');
      assertMediaWorkspace(media.url, (conversation as Conversation).workspace_id);
    } catch {
      return NextResponse.json(
        { error: translate(locale, "errInbox.forbidden") },
        { status: 403 },
      );
    }
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
  let { data: connection } = await admin
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
  // El estado del panel puede quedar unos segundos por detrás del sondeo de
  // Mercado Libre. El servidor vuelve a comprobarlo para que un compositor
  // viejo no cree burbujas fallidas ni intente escribir en un reclamo cerrado.
  const threadExternalId = (conversation as Conversation).thread_external_id ?? "";
  if (channel === "mercadolibre" && threadExternalId.startsWith("claim:")) {
    const claimId = threadExternalId.slice("claim:".length);
    const { data: claim } = await admin
      .from("ml_claims")
      .select("status")
      .eq("workspace_id", (conversation as Conversation).workspace_id)
      .eq("claim_id", claimId)
      .maybeSingle();
    if (
      (conversation as Conversation).status === "closed" ||
      String((claim as { status?: string } | null)?.status ?? "").toLowerCase() === "closed"
    ) {
      return NextResponse.json(
        {
          error: translate(locale, "inbox.mlClaimClosed"),
          code: "ML_CLAIM_CLOSED",
        },
        { status: 409 },
      );
    }
  }
  // Approved Meta templates belong to WhatsApp. Other channels can reuse the
  // rendered content, but it must travel as a regular text/media message.
  const templateName = channel === "whatsapp" ? requestedTemplateName : null;
  if (!body.text?.trim() && !media && !templateName) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.sendMissingFields") },
      { status: 400 },
    );
  }
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
    : channel === "gmail" || channel === "outlook" || channel === "zoho"
      ? "email"
      : channel === "fb_comment" ||
          channel === "ig_comment" ||
          channel === "tiktok_comment"
        ? "comment"
        : "text";

  // Instagram y Messenger permiten que una persona continúe soporte durante
  // siete días con HUMAN_AGENT. Este endpoint siempre pertenece a una persona
  // autenticada; el adapter intenta RESPONSE y, fuera de 24 h, reintenta con
  // esa etiqueta. Después de siete días Meta sí bloquea el envío.
  if ((channel === "instagram" || channel === "messenger") && !templateName) {
    const { data: lastCustomerMessage } = await admin
      .from("messages")
      .select("created_at")
      .eq("conversation_id", (conversation as Conversation).id)
      .eq("sender_type", "customer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (metaHumanReplyExpired(channel, lastCustomerMessage?.created_at)) {
      return NextResponse.json(
        {
          error: translate(locale, "inbox.metaSessionExpiredBanner"),
          code: "META_SESSION_EXPIRED",
        },
        { status: 409 },
      );
    }
  }

  // Comment replies must target a COMMENT id, not the post id. The
  // conversation's thread_external_id is the post/media id (used for
  // grouping), so replying to that 400s ("object does not exist").
  // Resolve the reply target to the specific comment the agent picked,
  // or fall back to the most recent inbound comment in the thread.
  let replyToExternalId = body.reply_to_external_id;
  if (esCanalDeComentarios(channel)) {
    const destino = await resolveCommentReplyTarget(admin, {
      workspaceId: (conversation as Conversation).workspace_id,
      conversation: conversation as Conversation,
      pickedMessageId: body.reply_to_external_id,
    });
    if (esError(destino)) {
      return NextResponse.json(
        {
          error: translate(
            locale,
            destino.error === "sin_conexion"
              ? "errInbox.connectionNotFound"
              : "errInbox.commentNoExternalId",
          ),
        },
        { status: 409 },
      );
    }
    replyToExternalId = destino.externalId;
    // La conexión DUEÑA del comentario, no la de la conversación: migración
    // 117. Quien comenta en dos cuentas del mismo comercio colapsa en un solo
    // hilo, que es de la primera — y su token no puede tocar el comentario de
    // la otra. `/moderate` y la edición ya lo hacían así; el envío no.
    connection = destino.connection;
  }

  // Disconnect is a hard stop. The row and its secrets stay in the database
  // so the historical conversation remains readable and reconnect can reuse
  // the identity, but neither a human nor an automated caller may send with
  // those retained credentials.
  try {
    assertConnectionCanSend(connection as ChannelConnection);
  } catch (error) {
    if (isChannelDisconnectedError(error)) {
      return NextResponse.json(
        {
          error: translate(locale, "errInbox.channelDisconnected"),
          code: CHANNEL_DISCONNECTED_CODE,
        },
        { status: 409 },
      );
    }
    throw error;
  }

  // Send through the channel adapter. On failure we still persist the
  // agent's message with status="failed" so their typed text is never
  // lost — it shows in the thread with a failed indicator — and we
  // return the error detail so the composer can surface it instead of a
  // bare 500.
  const adapter = getAdapter(channel);
  // Los links salen marcados y se GUARDAN marcados, en ese orden y con el
  // mismo texto: el hilo tiene que mostrar exactamente lo que le llegó al
  // cliente. Va antes de todo lo que lee `body.text` para que no haya dos
  // versiones dando vueltas.
  if (typeof body.text === "string") {
    body.text = await prepararTextoParaCanal(admin, {
      texto: body.text,
      canal: channel,
      workspaceId: (conversation as Conversation).workspace_id,
      contactId: (contact as Contact).id,
    });
  }
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
      // Una plantilla con botón de enlace VARIABLE necesita un link distinto por
      // cliente (el carrito de ESA persona, el seguimiento de ESE pedido): eso
      // solo lo sabe el disparador de una automatización. Mandada a mano, Meta
      // la rechazaba con "(#131008) Required parameter is missing", que no le
      // dice nada a nadie. Se avisa antes de gastar el envío.
      if (
        await templateNeedsDynamicLink(
          admin,
          (conversation as Conversation).workspace_id,
          templateName,
        )
      ) {
        throw new Error(translate(locale, "errInbox.templateDynamicLink"));
      }
      result = await adapter.sendTemplate({
        channel,
        connection: connection as ChannelConnection,
        conversation: conversation as Conversation,
        contact: contact as Contact,
        templateName,
        language: body.template_language,
        params: Array.isArray(body.template_params) ? body.template_params : [],
        headerImageUrl: mediaSendType === "image" ? (media?.url as string) : undefined,
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

  await resolveHumanAttention(admin, message);

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

  // La entrega al destino nunca puede bloquear la respuesta de la bandeja.
  void emitWebhook((conversation as Conversation).workspace_id, 'message.sent', {
    conversation_id: (conversation as Conversation).id,
    message_id: (message as Message | null)?.id ?? null,
    channel,
  }).catch((error) => console.error('[webhook] outbound message delivery failed', error));

  if ((message as Message | null)?.media_url || (message as Message | null)?.attachments?.length) {
    after(async () => {
      const workspaceId = (conversation as Conversation).workspace_id;
      if (!(await motorApagado(admin, workspaceId)) && (await puertaDeIa(admin, workspaceId)).puede) {
        await enrichConversationEvidence(admin, { workspaceId, conversationId: (conversation as Conversation).id });
      }
    });
  }
  return NextResponse.json({
    ok: true,
    message: message as Message,
    ...(await avisoRepeticionTikTok(admin, {
      channel,
      workspaceId: (conversation as Conversation).workspace_id,
      text: contentText ?? null,
    })),
  });
}

/**
 * Aviso de respuesta repetida en TikTok.
 *
 * TikTok oculta las respuestas del comercio sin decirlo: quedan visibles para
 * quien las escribió y para nadie más. En la primera cuenta conectada eso pasó
 * con 89 de 138 respuestas, y lo que tenían en común era ser el mismo bloque
 * pegado una y otra vez — la misma promoción con el mismo enlace, 98 veces.
 * Las respuestas cortas y distintas entre sí sobrevivieron.
 *
 * No se toca el texto: lo que la persona escribió se manda tal cual. Sólo se
 * le dice, la tercera vez que manda exactamente lo mismo, que ese es el camino
 * a que TikTok la esconda. El botón de generar respuesta escribe una distinta
 * cada vez, que es la salida.
 */
async function avisoRepeticionTikTok(
  db: ReturnType<typeof supabaseAdmin>,
  args: { channel: Channel; workspaceId: string; text: string | null },
): Promise<{ warning?: string }> {
  if (args.channel !== "tiktok_comment") return {};
  const normalizado = normalizarComentario(args.text ?? "");
  if (normalizado.length < 25) return {}; // "gracias ❤️" se repite y no molesta a nadie
  try {
    const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await db
      .from("messages")
      .select("content_text, conversations!inner(workspace_id)")
      .eq("channel", "tiktok_comment")
      .in("sender_type", ["agent", "bot"])
      .eq("conversations.workspace_id", args.workspaceId)
      .gte("created_at", desde)
      .limit(300);
    const iguales = ((data ?? []) as Array<{ content_text: string | null }>).filter(
      (m) => normalizarComentario(m.content_text ?? "") === normalizado,
    ).length;
    if (iguales < 3) return {};
    const locale = await getLocale();
    return { warning: translate(locale, "errInbox.tiktokRepeatedReply", { veces: String(iguales) }) };
  } catch {
    return {}; // un aviso nunca puede romper un envío
  }
}

function normalizarComentario(texto: string): string {
  return texto.trim().toLowerCase().replace(/\s+/g, " ");
}
