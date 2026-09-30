import { resolveHumanAttention } from '@/lib/inbox/human-attention';
import { isSimpleClosure, reconcileHumanAttention } from '@/lib/inbox/reconcile-human-attention';
import { enrichConversationEvidence } from '@/lib/ai/conversation-evidence';
import { motorApagado } from '@/lib/workspaces/motor';
import { puertaDeIa } from '@/lib/wallet/puerta';
import { workspaceReadOnly } from '@/lib/billing/read-only';
import { shouldDeferBillingReply } from '@/lib/billing/reply-backlog';
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Channel,
  Contact,
  Conversation,
  Message,
  MessageAttachment,
} from "@/types";
import type { InboundEvent } from "./types";
import { runAiAgent } from "@/lib/ai/runner";
import { dispatchAutomationsAndFlows } from "./inbound-dispatch";
import { linkUnifiedContact } from "@/lib/contacts/dedupe";
import type { OrigenDelDato } from "@/lib/contacts/identidad-probada";
import { resolveAssignmentForConversation } from "@/lib/inbox/assignment-rules";
import { mimeToCategory } from "./media-ingest";
import { isMediaPlaceholderText, mediaPreviewToken } from "./display";
import { isStoryMentionOrShareOnly } from "./meta-attachments";
import { esRespuestaAutomatica } from "./respuesta-automatica";
import {
  maybeRunCloser,
  markCampaignReply,
  hasInstagramAgent,
} from "@/lib/instagram-agent/realtime";
import { enrichContactProfile } from "@/lib/instagram-agent/profile-enrich";
import { routeComment } from "@/lib/comments/router";
import { phonesMatch, sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils";
import {
  isOptOutKeyword,
  isOptInKeyword,
  markOptedOut,
  markOptedIn,
} from "@/lib/whatsapp/opt-out";
import { getAdapter } from "./registry";
import { originFromProactiveKind } from "@/lib/inbox/message-origin";
import { storedConnectionCanSend } from "./send-guard";

/**
 * ¿Este saliente que llega de la plataforma lo mandó una funcionalidad nuestra?
 *
 * El DM de una regla de comentarios y la respuesta pública de Comentarios se
 * envían por el adapter y aparecen en la bandeja recién cuando Meta manda el
 * eco: para entonces son indistinguibles de algo que escribió una persona desde
 * la app. Dos libros los delatan:
 *
 *   comment_to_dm_log — guarda el id EXTERNO del DM y de la respuesta pública de
 *                       cada regla: match exacto, sin ambigüedad.
 *   ig_proactive_log  — guarda el texto de cada envío proactivo de la IA.
 *
 * Best-effort: si no hay match, el mensaje queda sin origen —que es exactamente
 * lo que corresponde para un mensaje escrito a mano.
 */
const PROACTIVE_CHANNELS = new Set<Channel>([
  "instagram",
  "messenger",
  "ig_comment",
  "fb_comment",
]);

async function originOfAutomatedSend(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    externalMessageId: string | null;
    text: string;
    at: string;
  },
): Promise<string | null> {
  const externalId = (args.externalMessageId ?? "").trim();
  if (externalId) {
    const { data: rule } = await db
      .from("comment_to_dm_log")
      .select("id")
      .eq("workspace_id", args.workspaceId)
      .or(
        `dm_external_id.eq.${externalId},public_reply_external_id.eq.${externalId}`,
      )
      .limit(1)
      .maybeSingle();
    if (rule) return "comment_rule";
  }

  const text = (args.text ?? "").trim();
  if (!text) return null;
  const since = new Date(Date.parse(args.at) - 15 * 60_000).toISOString();
  const { data } = await db
    .from("ig_proactive_log")
    .select("kind")
    .eq("workspace_id", args.workspaceId)
    .eq("text", text.slice(0, 1000))
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const kind = (data as { kind?: string } | null)?.kind;
  return kind ? originFromProactiveKind(kind) : null;
}

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
  // Defense in depth: routers and pollers already exclude disconnected rows,
  // but their snapshot can become stale while an event is in flight. Re-read
  // the stored status at the ingestion chokepoint before writing anything.
  if (
    event.connection.status === "disconnected" ||
    !(await storedConnectionCanSend(db, event.connection.id))
  ) {
    return null;
  }

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
      .select("id, content_text, media_url, conversations!inner(workspace_id)")
      .eq("message_id", event.externalMessageId)
      .eq("conversations.workspace_id", workspaceId)
      .limit(1)
      .maybeSingle();
    if (already) {
      // Un repetido puede traer el archivo que a la fila le falta. El
      // historial de coexistencia manda primero el mensaje con un marcador y
      // después el MISMO mensaje con su archivo; una relectura del diario o una
      // reentrega trae el archivo que la primera vez no se pudo bajar. Se
      // completa la fila en vez de tirar el archivo. El id salió de la consulta
      // acotada al workspace, así que la escritura también lo está.
      const patch = missingMediaPatch(channel, already, event);
      if (patch) {
        await db.from("messages").update(patch).eq("id", already.id);
      }
      return null;
    }
  }

  // Para ingestas HISTÓRICAS (backfill de DMs / echoes viejos / respuestas de
  // Mercado Libre pasadas) datamos el contacto y la conversación al momento del
  // mensaje, NO a NOW(): si no, "Contactos nuevos" del panel contaría una
  // relación vieja como nueva de HOY, incoherente con el mensaje (que sí se
  // fecha histórico). En webhooks en vivo receivedAt ≈ ahora → no cambia nada.
  const nowMs = Date.now();
  const evMs = Date.parse(event.receivedAt);
  const historicalCreatedAt =
    Number.isFinite(evMs) && evMs < nowMs ? event.receivedAt : undefined;

  // 1. Upsert contact by (workspace_id, channel, external_id).
  const contactOutcome = { wasCreated: false };
  const contact = await upsertContact(
    db,
    {
      workspace_id: workspaceId,
      channel,
      external_id: event.externalContactId,
      name: event.contactName,
      avatar_url: event.contactAvatarUrl,
      // El identificador del canal ES la identidad: el numero con el que
      // escribe por WhatsApp es su numero, la casilla desde la que manda un
      // correo es su casilla. No hay dato mas probado que ese, y por eso se
      // marca `canal` (migracion 206) -- es lo que habilita unirlo con su
      // ficha de otro canal.
      email: channel === "gmail" || channel === "outlook" || channel === "zoho" ? event.externalContactId : undefined,
      phone: channel === "whatsapp" ? event.externalContactId : undefined,
      email_origen:
        channel === "gmail" || channel === "outlook" || channel === "zoho" ? "canal" : undefined,
      phone_origen: channel === "whatsapp" ? "canal" : undefined,
      created_at: historicalCreatedAt,
    },
    contactOutcome,
  );
  if (!contact) return null;

  // 1b. Cross-channel dedupe (migration 050). Si este contact comparte
  //     teléfono normalizado o email con otro del mismo workspace, lo
  //     enlazamos al "primario" (el más viejo del grupo). El runner de
  //     IA después lee ai_summary + shopify_customer_data desde el
  //     primario. Fail-soft — no rompe el ingest si falla.
  await linkUnifiedContact(db, contact).catch(() => contact.id);

  // Preview de la lista. Un mensaje que es SÓLO un archivo (una nota de voz,
  // una foto) llega con texto vacío y la conversación quedaba diciendo "Sin
  // mensajes" aunque el mensaje estuviera ahí. Guardamos el marcador del tipo
  // —la UI lo muestra en el idioma del usuario (localizeContentToken)— sin
  // tocar el content_text del mensaje, que sigue vacío para que la burbuja
  // muestre el reproductor y nada más.
  const previewText = event.text?.trim()
    ? event.text
    : mediaPreviewToken(event.attachments?.[0]?.mime_type);

  // 2. Find-or-create conversation. Emails group by threadId; everything
  //    else keeps one open conversation per (contact, channel).
  //    Un evento que sólo trae contexto de anuncio (referralOnly) jamás abre
  //    una conversación: sella la que ya existe y se va.
  const conversation = await findOrCreateConversation(db, {
    workspace_id: workspaceId,
    contact_id: contact.id,
    channel,
    connection_id: event.connection.id,
    subject: event.subject,
    thread_external_id: event.externalThreadId ?? event.comment?.postId ?? null,
    firstMessageText: previewText,
    lastMessageAt: event.receivedAt,
    lastSenderType: event.outbound ? "agent" : "customer",
    createIfMissing: event.referralOnly ? false : event.createIfMissing,
    created_at: historicalCreatedAt,
  });
  if (!conversation) return null;

  // 2b. CTWA: if this message arrived from a Click-to-WhatsApp ad, stamp the ad
  //     source on the conversation ONCE — so the same agent/enrichment knows the
  //     origin and attribution can tie a later sale back to the exact ad.
  //     Best-effort; never blocks the ingest.
  if (event.referral && !event.outbound) {
    await db
      .from("conversations")
      .update({ ad_referral: event.referral })
      .eq("id", conversation.id)
      .is("ad_referral", null)
      .then(
        () => {},
        () => {},
      );
  }
  // El evento de anuncio suelto no es un mensaje: ya selló el origen, cortamos
  // antes de insertar nada (si no, quedaría una burbuja en blanco en el hilo).
  if (event.referralOnly) return null;

  // 2c. Reconciliar "enviado pero marcado fallido". Si un envío desde Riverz
  //     falló en HTTP DESPUÉS de que la plataforma ya lo entregó, quedó una
  //     fila placeholder (sender_type='agent', status='failed', message_id
  //     NULL). El echo/backfill trae ahora el id real: sin esto se insertaría
  //     una SEGUNDA fila y el mensaje saldría DUPLICADO (una 'failed' + una
  //     'sent'). Reconciliamos la placeholder (le ponemos el id real y status
  //     'sent') en vez de insertar. Solo para salientes con texto — un match
  //     por (conversación, agente, message_id NULL, mismo texto, reciente) es
  //     inequívoco (los envíos exitosos ya traen message_id y no matchean).
  if (event.outbound && event.externalMessageId && event.text.trim()) {
    const sinceIso = new Date(
      Date.parse(event.receivedAt) - 10 * 60_000,
    ).toISOString();
    const { data: placeholder } = await db
      .from("messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .in("sender_type", ["agent", "bot"])
      .is("message_id", null)
      .eq("content_text", event.text)
      .in("status", ["failed", "sending", "sent"])
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (placeholder) {
      await db
        .from("messages")
        .update({ message_id: event.externalMessageId, status: "sent" })
        .eq("id", (placeholder as { id: string }).id);
      return {
        contact,
        conversation,
        message: {
          ...(placeholder as Message),
          message_id: event.externalMessageId,
          status: "sent",
        },
      };
    }
  }

  // 3. Insert message — idempotent on external id.
  const insertPayload: Record<string, unknown> = {
    conversation_id: conversation.id,
    channel,
    // Sent-folder emails come back as outbound (we authored them), so
    // they land as agent messages on the right side of the thread.
    sender_type: event.outbound ? "agent" : "customer",
    ...mediaColumns(channel, event.attachments),
    content_text: event.text,
    html_body: event.htmlBody,
    subject: event.subject,
    attachments: event.attachments ?? null,
    message_id: event.externalMessageId,
    status: event.outbound ? "sent" : "delivered",
    created_at: event.receivedAt,
    billing_recovery_eligible: shouldDeferBillingReply(event,conversation),
    // De qué interacción nació (respuesta a historia, mención en historia).
    // Null en la inmensa mayoría: es un mensaje normal.
    engagement_kind: event.engagementKind ?? null,
  };
  // ¿Es el eco de un envío AUTOMÁTICO nuestro? Hay dos caminos que no escriben
  // la fila ellos mismos —el DM de una regla de comentarios y la respuesta
  // pública en el propio comentario— y llegan a la bandeja por el eco de Meta,
  // ya sin rastro de quién los originó. `ig_proactive_log` es ese rastro
  // (migración 143).
  // Solo en los canales donde hay envíos proactivos (Meta): en correo o Mercado
  // Libre esta consulta nunca acertaría y el poll trae salientes de a montones.
  if (event.outbound && PROACTIVE_CHANNELS.has(channel)) {
    const attributed = await originOfAutomatedSend(db, {
      workspaceId,
      externalMessageId: event.externalMessageId ?? null,
      text: event.text,
      at: event.receivedAt,
    });
    if (attributed) insertPayload.origin = attributed;
  }
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

  await resolveHumanAttention(db, message);
  if (!event.outbound && isSimpleClosure(message.content_text)) {
    await reconcileHumanAttention(db, conversation.id);
  }
  // Persist interpretation even when a flow consumes the turn or a human owns the chat.
  if (!event.historical && event.attachments?.length && !(await motorApagado(db, workspaceId)) && (await puertaDeIa(db, workspaceId)).puede) {
    await enrichConversationEvidence(db, { workspaceId, conversationId: conversation.id });
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
      // The account that actually RECEIVED this comment. FB/IG comments group
      // one conversation per (contact, channel), so a commenter who hits two of
      // a workspace's accounts collapses into one conversation owned by the
      // first — reply attribution by conversation.connection_id would use the
      // wrong page token. Stamp the true owner per comment (migration 117).
      connection_id: event.connection.id,
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

  // Una respuesta a nuestra historia (o una mención en la suya) es una reacción
  // a NUESTRO contenido, igual que un comentario — y así se tiene que poder
  // triar. Se sube a la conversación, como `is_ad`, para que la pestaña
  // Comentarios de la bandeja la encuentre sin recorrer los mensajes. Solo la
  // primera vez: el hilo nació de una historia y eso ya no cambia.
  if (
    !event.outbound &&
    (event.engagementKind === "story_reply" ||
      event.engagementKind === "story_mention") &&
    !conversation.engagement_kind
  ) {
    await db
      .from("conversations")
      .update({ engagement_kind: event.engagementKind })
      .eq("id", conversation.id)
      .is("engagement_kind", null);
  }

  // Un comentario entra por UN solo portero, que decide en orden fijo quién lo
  // atiende: primero las reglas que configuró el comercio, después el agente.
  // Antes eran dos caminos disparados en paralelo y quién atendía a la persona
  // lo decidía el azar de cuál terminara primero.
  //
  // Un comentario RESCATADO no pasa por el portero. El pull recoge lo que el
  // webhook perdió, y cuando la pérdida duró días —la suscripción de Meta quedó
  // apuntando a un dominio muerto— responder en diferido es peor que no
  // responder: el comercio ya contestó a mano y el cliente recibe un bot
  // hablando de algo de la semana pasada. Sigue entrando a la bandeja y
  // sumando no leído (`suppressAutoReply`, no `historical`), así que se ve y se
  // puede contestar a mano. `historical` corta por la misma razón, un grado más
  // fuerte: eso ni siquiera se cuenta como pendiente.
  // Persist first. Billing never disables ingestion, including native app echoes.
  // Only live, answerable customer messages become recovery work.
  let paymentPaused=false;
  if(!event.outbound && !event.historical) {
    try { paymentPaused=await workspaceReadOnly(db,workspaceId); }
    catch { paymentPaused=true; }
  }
  if (
    !paymentPaused &&
    event.comment &&
    message &&
    !event.outbound &&
    !event.historical &&
    !event.suppressAutoReply &&
    (channel === "ig_comment" ||
      channel === "fb_comment" ||
      channel === "tiktok_comment")
  ) {
    void routeComment(db, {
      workspaceId,
      channel,
      connection: event.connection,
      contact: {
        id: contact.id,
        external_id: contact.external_id ?? null,
        name: contact.name ?? null,
      },
      commentId: event.externalMessageId ?? null,
      postId: event.comment.postId ?? null,
      parentCommentId: event.comment.parentCommentId ?? null,
      text: event.text,
    }).catch((err) => console.error("[comment-router] failed:", err));
  }

  // 5. Bump conversation summary fields. Outbound (our own sent mail) must no
  //    incrementar el contador de no-leídos. Los campos de resumen/orden solo
  //    avanzan HACIA ADELANTE: un saliente histórico del backfill no debe
  //    rebobinar last_message_at (hundiría la conversación viva en la bandeja
  //    con un preview viejo). En vivo el evento siempre es >= el actual.
  const evTs = Date.parse(event.receivedAt);
  const curTs = conversation.last_message_at
    ? Date.parse(conversation.last_message_at)
    : NaN;
  const isNewer = Number.isNaN(curTs) || (Number.isFinite(evTs) && evTs >= curTs);
  //    Un entrante HISTÓRICO (relleno de la conversación desde Meta) tampoco
  //    suma no-leídos: es historia que ya pasó, no algo nuevo por responder.
  const summaryPatch: Record<string, unknown> = {
    unread_count:
      event.outbound || event.historical
        ? (conversation.unread_count ?? 0)
        : (conversation.unread_count ?? 0) + 1,
    updated_at: new Date().toISOString(),
  };
  if (isNewer) {
    summaryPatch.last_message_text = previewText.slice(0, 200);
    summaryPatch.last_message_at = event.receivedAt;
    summaryPatch.last_sender_type = event.outbound ? "agent" : "customer";
  }
  await db.from("conversations").update(summaryPatch).eq("id", conversation.id);

  // Fire the AI customer-service agent for inbound (customer) text
  // messages. Comments are skipped — the AI flow only owns 1:1 chat
  // surfaces (DMs and email). Fire-and-forget so a slow LLM call
  // never blocks the webhook response.
  // Instagram-only: un DM que es SOLO una mención-en-historia o un post
  // compartido (story_mention/share) llega con texto vacío y sin adjunto
  // bajable, y antes disparaba al agente a "responder a la nada". Acotamos el
  // gate a instagram para no cambiar el comportamiento de otros canales (un
  // email solo-asunto o una ubicación de Messenger SÍ deben responderse; sus
  // adapters además emiten texto de fallback, así que no aplica).
  // ── Baja / alta por palabra clave, en TODOS los canales de mensajería ──
  // Antes esto solo existía en el webhook de WhatsApp: un "no me escribas más"
  // por Instagram o Messenger no daba de baja a nadie y el agente proactivo
  // seguía escribiéndole. El mensaje ya quedó guardado (hace falta como prueba
  // del pedido de baja); cortamos antes de la IA para que ningún bot le
  // conteste salvo el acuse.
  if (
    !event.outbound &&
    !event.historical &&
    (channel === "instagram" || channel === "messenger") &&
    event.text?.trim()
  ) {
    const optOut = isOptOutKeyword(event.text);
    const optIn = !optOut && isOptInKeyword(event.text);
    if (optOut || optIn) {
      if (optOut) {
        await markOptedOut(db, workspaceId, contact.id, "inbound_keyword");
      } else {
        await markOptedIn(db, workspaceId, contact.id);
      }
      if (!paymentPaused) await acknowledgeOptChange(db, {
        channel,
        connection: event.connection,
        conversation,
        contact,
        optedOut: optOut,
      });
      return { contact, conversation, message: message as Message };
    }
  }

  if(paymentPaused) return {contact,conversation,message:message as Message};

  // Un DM de Instagram que es SOLO una mención en historia o una publicación
  // compartida se guarda para que la conversación se vea completa, pero no le
  // pide nada al agente: no hay pregunta que responder.
  //
  // El criterio es el SIGNIFICADO del marcador, no su forma. Hasta el
  // 2026-08-30 esto era `/^\[[^\]]+\]$/` —"cualquier cosa entre corchetes"— y
  // se comía también `[unsupported]`, o sea todo lo que Instagram no nos
  // entrega. El agente no se enteraba: ni respuesta, ni fila `skipped` en
  // `ai_replies`, ni escalada. Una clienta mandó tres fotos en ver-una-vez
  // después de que el agente le pidiera una foto, y el sistema quedó mudo.
  // Ese caso lo atiende el runner (`runner.ts`, "lo que no nos llega no se
  // contesta dos veces"), y para atenderlo tiene que llegarle.
  const igEmptyDm =
    channel === "instagram" &&
    (!(
      Boolean(event.text && event.text.trim()) ||
      Boolean(event.attachments && event.attachments.length)
    ) ||
      isStoryMentionOrShareOnly(event.text));
  // El contestador del cliente ("Gracias por comunicarte con X, ¿cómo podemos
  // ayudarte?") no es una persona: se guarda, pero no despierta a la IA ni a
  // las automatizaciones. `conversation` todavía trae el resumen ANTERIOR a
  // este entrante, que es justo lo que hace falta: quién habló último y cuándo.
  const contestador =
    !event.outbound &&
    !event.historical &&
    esRespuestaAutomatica({
      texto: event.text,
      ultimoRemitente: conversation.last_sender_type ?? null,
      ultimoMensajeAt: conversation.last_message_at ?? null,
      recibidoAt: event.receivedAt,
    });
  if (contestador) {
    console.info(
      `[inbox] respuesta automática del contacto ${contact.id} por ${channel}: no se responde sola`,
    );
  }
  if (
    !event.outbound &&
    !event.historical &&
    !event.suppressAutoReply &&
    !contestador &&
    !igEmptyDm &&
    // Los tres canales de comentarios los atiende `routeComment`, arriba.
    // `tiktok_comment` faltaba en esta lista, así que cumplía las DOS ramas: el
    // piso autónomo publicaba su respuesta y el runner de DM publicaba otra por
    // el adaptador. Dos comentarios públicos bajo el mismo video, dos llamadas
    // al modelo y dos cobros. Verificado en producción el 2026-08-30: pasó una
    // vez (2026-08-27) sobre 485 hilos, porque el runner además necesita un
    // agente activo cuyo alcance cubra el canal.
    //
    // De paso deja de disparar automatizaciones y flujos —pensados para DM—
    // sobre un comentario público. Ningún `flow_runs` los usaba.
    channel !== "fb_comment" &&
    channel !== "ig_comment" &&
    channel !== "tiktok_comment"
  ) {
    // Automatizaciones y flujos ANTES que la IA. Vivían sólo en el webhook
    // legacy de WhatsApp, así que por este camino no disparaban nunca — y en
    // Instagram/Messenger/correo/Mercado Libre no existían en absoluto.
    // Si un flujo consume el mensaje, el cliente está contestando un guion
    // interactivo y la IA no debe hablar encima; una automatización que
    // responde NO la silencia (la IA conversa con ese contexto).
    const flowConsumed = await dispatchAutomationsAndFlows(db, {
      workspaceId,
      channel,
      conversation,
      contact,
      message: message as Message,
      isFirstInboundMessage: await isFirstInboundFromContact(db, contact.id, message as Message),
      contactWasCreated: contactOutcome.wasCreated,
    });

    const dispatchGeneric = () =>
      flowConsumed
        ? Promise.resolve()
        : runAiAgent(db, {
            workspaceId,
            channel,
            conversation,
            contact,
            connection: event.connection,
            inboundMessage: message as Message,
          }).catch((err) => console.error("[ai] dispatch failed:", err));

    if (channel === "instagram") {
      // A DM makes this person Profile-API-eligible — enrich who they are
      // (profile-pic vision + follow relationship + follower tier) for
      // Blueberry-style 1:1 personalization. Fire-and-forget, TTL-guarded,
      // fail-soft; never blocks the reply.
      if (contact.external_id) {
        void enrichContactProfile(db, {
          contactId: contact.id,
          igsid: contact.external_id,
          connection: event.connection,
        }).catch(() => {});
      }
      // Si respondió alguien de una campaña, queda marcado en el embudo pase
      // lo que pase después (responda el agente configurado o el respaldo).
      void markCampaignReply(db, contact.id).catch(() => {});

      // Quién contesta: SIEMPRE el agente de IA que el comercio configuró para
      // Instagram — lleva su catálogo, sus reglas y sus herramientas (crear el
      // pedido, generar checkout, escalar a un humano), y recibe el contexto de
      // la campaña por loadInstagramContext. El cerrador de campaña queda solo
      // como respaldo para workspaces sin ningún agente activo, para que el
      // cliente no se quede en silencio.
      const runCampaignCloserFallback = () =>
        maybeRunCloser(db, {
          workspaceId,
          contact: {
            id: contact.id,
            external_id: contact.external_id ?? null,
            name: contact.name ?? null,
          },
          connection: event.connection,
          inboundText: event.text,
          // Para respetar los controles del chat (kill-switch / toma por
          // humano / cerrado) y el debounce anti-ráfaga dentro del cerrador.
          conversation: {
            id: conversation.id,
            ai_enabled:
              (conversation as { ai_enabled?: boolean | null }).ai_enabled ?? null,
            assigned_agent_id: conversation.assigned_agent_id ?? null,
            status: conversation.status ?? null,
          },
          inboundMessage: {
            id: (message as Message).id,
            created_at: (message as Message).created_at,
          },
        })
          .then((handled) => {
            if (!handled) dispatchGeneric();
          })
          .catch(() => dispatchGeneric());

      void hasInstagramAgent(db, workspaceId)
        .then((hasAgent) =>
          hasAgent ? dispatchGeneric() : runCampaignCloserFallback(),
        )
        .catch(() => dispatchGeneric());
    } else {
      dispatchGeneric();
    }
  }

  return { contact, conversation, message: message as Message };
}

export interface UpsertContactInput {
  workspace_id: string;
  channel: Channel;
  external_id: string;
  name?: string;
  avatar_url?: string;
  email?: string;
  phone?: string;
  /** De donde salio cada dato (migracion 206). Decide si puede unir. */
  email_origen?: OrigenDelDato;
  phone_origen?: OrigenDelDato;
  /** Momento histórico del primer mensaje visto (backfill); si se omite, la DB
   *  usa NOW(). Solo aplica al INSERT — nunca reescribe un contacto existente. */
  created_at?: string;
}

/**
 * Columnas estructuradas del mensaje según el canal y el primer adjunto. El
 * JSONB `attachments` guarda todos; sólo el primero llena estas columnas.
 */
function mediaColumns(
  channel: Channel,
  attachments: MessageAttachment[] | undefined,
): {
  content_type: string;
  media_url: string | null;
  media_type: string | null;
  media_mime: string | null;
  media_size: number | null;
} {
  const baseContentType: string =
    channel === "gmail" || channel === "outlook" || channel === "zoho"
      ? "email"
      : channel === "fb_comment" || channel === "ig_comment"
        ? "comment"
        : "text";
  const first = attachments?.[0];
  if (!first?.url) {
    return {
      content_type: baseContentType,
      media_url: null,
      media_type: null,
      media_mime: null,
      media_size: null,
    };
  }
  const mime = first.mime_type ?? null;
  const mediaType = mime ? mimeToCategory(mime) : null;
  // Si todavía estamos en texto pero hay media, bumpeamos el content_type para
  // que el inbox y los filtros sepan que hay adjunto. Email/comment mantienen
  // su tipo de alto nivel.
  const contentType =
    baseContentType === "text" && mediaType
      ? mediaType === "voice"
        ? "audio"
        : mediaType === "sticker"
          ? "image"
          : mediaType
      : baseContentType;
  return {
    content_type: contentType,
    media_url: first.url,
    media_type: mediaType,
    media_mime: mime,
    media_size: first.size ?? null,
  };
}

/**
 * Lo que hay que escribir cuando un evento repetido trae el archivo que a la
 * fila guardada le falta, en cualquier canal. Null si no hay nada que
 * completar: la fila ya tiene archivo o el evento tampoco lo trae.
 *
 * El texto guardado se conserva salvo que sea sólo el lugar del archivo (el
 * marcador del historial de coexistencia, "[Imagen]", "[Audio]"…): un pie de
 * foto o un mensaje son de la persona y no se pisan.
 */
export function missingMediaPatch(
  channel: Channel,
  existing: { content_text?: string | null; media_url?: string | null },
  event: Pick<InboundEvent, "attachments" | "text">,
): Record<string, unknown> | null {
  const attachments = event.attachments ?? [];
  if (existing.media_url || !attachments.some((a) => a.url)) return null;
  // Las columnas salen del primer adjunto CON archivo: si el primero de la
  // lista no lo trae, la fila quedaría otra vez sin `media_url`.
  const first = attachments.filter((a) => a.url);
  const patch: Record<string, unknown> = {
    ...mediaColumns(channel, first),
    attachments,
  };
  const stored = String(existing.content_text ?? "").trim();
  if (!stored || isMediaPlaceholderText(stored)) patch.content_text = event.text;
  return patch;
}

/**
 * ¿Es este el PRIMER mensaje que nos escribe este contacto?
 *
 * Alimenta el trigger `first_inbound_message` de las automatizaciones, que
 * hasta ahora sólo existía en el webhook legacy de WhatsApp. Cuenta los
 * mensajes de cliente del contacto: si el único es el que acabamos de
 * guardar, es el primero. Ante un error de DB devuelve `false` (mejor no
 * disparar de más que dispararle a alguien que ya venía conversando).
 */
async function isFirstInboundFromContact(
  db: SupabaseClient,
  contactId: string,
  justWritten: Message,
): Promise<boolean> {
  try {
    const { data } = await db
      .from("messages")
      .select("id, conversations!inner(contact_id)")
      .eq("conversations.contact_id", contactId)
      .eq("sender_type", "customer")
      .limit(2);
    const rows = (data ?? []) as Array<{ id: string }>;
    return rows.length <= 1 && rows.every((r) => r.id === justWritten.id);
  } catch {
    return false;
  }
}

export async function upsertContact(
  db: SupabaseClient,
  input: UpsertContactInput,
  /** Out-param opcional: queda en `true` sólo si esta llamada CREÓ la fila.
   *  Lo necesita el trigger de automatización `new_contact_created`, que
   *  antes sólo existía en el webhook legacy de WhatsApp. */
  outcome?: { wasCreated: boolean },
): Promise<Contact | null> {
  // We rely on the (workspace_id, channel, external_id) unique index
  // created in migration 013 (`uq_contact_identity`).
  let { data: existing } = await db
    .from("contacts")
    .select("*")
    .eq("workspace_id", input.workspace_id)
    .eq("channel", input.channel)
    .eq("external_id", input.external_id)
    .maybeSingle();

  // WhatsApp: the wa_id Meta sends is NOT always the phone we stored. An
  // Argentine mobile is "54911…" as wa_id but "5411…" when normalized from a
  // Shopify order (libphonenumber keeps the landline form), so the exact
  // external_id lookup misses and the reply would open a SECOND contact +
  // conversation — splitting the thread from the automation that just
  // messaged them. Fall back to the contact's wa_id (stamped by the senders)
  // or a phonesMatch on the stored phone before creating anything.
  if (!existing && input.channel === "whatsapp") {
    const waId = sanitizePhoneForMeta(input.external_id);
    const last8 = waId.slice(-8);
    if (waId && last8.length === 8) {
      const { data: candidates } = await db
        .from("contacts")
        .select("*")
        .eq("workspace_id", input.workspace_id)
        .eq("channel", "whatsapp")
        .or(`wa_id.eq.${waId},phone.like.%${last8}`)
        .order("created_at", { ascending: true });
      const rows = (candidates ?? []) as Contact[];
      const match =
        rows.find((c) => (c as { wa_id?: string | null }).wa_id === waId) ??
        rows.find((c) => c.phone && phonesMatch(c.phone, waId));
      if (match) {
        // Stamp the real WhatsApp identity so the next inbound resolves on
        // the fast wa_id path. external_id stays untouched — the Shopify
        // upsert keys on it.
        if (!(match as { wa_id?: string | null }).wa_id) {
          await db.from("contacts").update({ wa_id: waId }).eq("id", match.id);
        }
        existing = match;
      }
    }
  }

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

  // La misma persona vive en dos filas: la del comentario (que sí trae
  // @usuario) y la del DM (que Meta entrega sin nombre). Cuando abrimos la del
  // DM, heredamos el nombre de su hermana en vez de dejar el hilo como
  // "Cliente Instagram · …9033".
  const inherited =
    !input.name && (input.channel === "instagram" || input.channel === "messenger")
      ? await siblingCommentIdentity(db, input)
      : null;

  const { data: created, error } = await db
    .from("contacts")
    .insert({
      workspace_id: input.workspace_id,
      channel: input.channel,
      external_id: input.external_id,
      name: input.name ?? inherited?.name ?? null,
      avatar_url: input.avatar_url ?? inherited?.avatar_url ?? null,
      email: input.email,
      phone: input.phone,
      ...(input.email_origen ? { email_origen: input.email_origen } : {}),
      ...(input.phone_origen ? { phone_origen: input.phone_origen } : {}),
      ...(input.created_at ? { created_at: input.created_at } : {}),
    })
    .select()
    .single();
  if (error) {
    // 23505 = dos entregas del mismo contacto nuevo en vuelo a la vez: ambas
    // vieron "no existe" y ambas insertaron. La que pierde volvía null y su
    // mensaje se PERDÍA (era el caso de una nota de voz que llega junto con
    // otro mensaje). Releemos la fila que ganó y seguimos con ella.
    if (error.code === "23505") {
      const { data: raced } = await db
        .from("contacts")
        .select("*")
        .eq("workspace_id", input.workspace_id)
        .eq("channel", input.channel)
        .eq("external_id", input.external_id)
        .maybeSingle();
      if (raced) return raced as Contact;
    }
    console.error("[inbox-writer] upsert contact failed:", error);
    return null;
  }
  if (outcome) outcome.wasCreated = true;
  return created as Contact;
}

/**
 * Acuse del alta/baja por el mismo canal, como hace el webhook de WhatsApp:
 * la persona tiene que saber que su pedido se registró. Best-effort — si el
 * envío falla, la baja YA quedó guardada, que es lo que importa.
 */
async function acknowledgeOptChange(
  db: SupabaseClient,
  input: {
    channel: Channel;
    connection: InboundEvent["connection"];
    conversation: Conversation;
    contact: Contact;
    optedOut: boolean;
  },
): Promise<void> {
  const text = input.optedOut
    ? "Listo, no volverás a recibir mensajes nuestros. Si cambias de opinión, escribe SUSCRIBIR."
    : "Bienvenido nuevamente. Volverás a recibir nuestros mensajes.";
  try {
    const adapter = getAdapter(input.channel);
    const result = await adapter.sendText({
      channel: input.channel,
      connection: input.connection,
      conversation: input.conversation,
      contact: input.contact,
      text,
    });
    await db.from("messages").insert({
      conversation_id: input.conversation.id,
      channel: input.channel,
      sender_type: "bot",
      content_type: "text",
      content_text: text,
      message_id: result?.externalMessageId ?? null,
      status: "sent",
    });
  } catch (err) {
    console.error("[inbox-writer] acuse de baja/alta falló:", err);
  }
}

/**
 * Nombre y foto que ya conocemos de esta persona por el canal de comentarios
 * (mismo workspace, mismo id de Instagram/Facebook). Devuelve null si no hay
 * hermana o si tampoco tiene nombre.
 */
async function siblingCommentIdentity(
  db: SupabaseClient,
  input: UpsertContactInput,
): Promise<{ name: string | null; avatar_url: string | null } | null> {
  const sibling = input.channel === "instagram" ? "ig_comment" : "fb_comment";
  const { data } = await db
    .from("contacts")
    .select("name, avatar_url")
    .eq("workspace_id", input.workspace_id)
    .eq("channel", sibling)
    .eq("external_id", input.external_id)
    .not("name", "is", null)
    .limit(1)
    .maybeSingle();
  return (data as { name: string | null; avatar_url: string | null } | null) ?? null;
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
  /** When false, return null instead of creating a conversation when none
   *  live exists — see InboundEvent.createIfMissing. Defaults to creating. */
  createIfMissing?: boolean;
  /** Momento histórico del primer mensaje (backfill); si se omite, NOW(). Solo
   *  aplica al INSERT de una conversación nueva. */
  created_at?: string;
}

/**
 * Channels grouped into ONE conversation per resource thread (by
 * thread_external_id) rather than one open conversation per (contact, channel):
 *   - gmail / outlook  → email thread id
 *   - mercadolibre     → "q:<id>" question / "pack:<id>" post-sale
 *   - tiktok_comment   → "video:<id>|comment:<id>" (each top-level comment is its
 *     own thread; without this, comments on different videos collapse into one
 *     conversation and a reply would target the wrong video/comment).
 * FB/IG comments intentionally stay grouped per contact.
 */
function isThreadGroupedChannel(channel: Channel): boolean {
  return (
    channel === "gmail" ||
    channel === "outlook" ||
    channel === "zoho" ||
    channel === "mercadolibre" ||
    channel === "tiktok_comment"
  );
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
  if (input.thread_external_id && isThreadGroupedChannel(input.channel)) {
    query = query.eq("thread_external_id", input.thread_external_id);
  } else {
    query = query.neq("status", "closed");
  }
  const { data: existing } = await query.limit(1).maybeSingle();
  if (existing) return existing as Conversation;

  // Backfill mode (createIfMissing === false): only fill gaps in threads that
  // already exist and are live. A historical message must never open a new
  // inbox row — above all it must not resurrect a conversation the user
  // soft-deleted, which the Meta DM backfill cron otherwise did every 6h.
  if (input.createIfMissing === false) return null;

  const { data: created, error } = await db
    .from("conversations")
    .insert({
      workspace_id: input.workspace_id,
      contact_id: input.contact_id,
      channel: input.channel,
      connection_id: input.connection_id,
      subject: input.subject,
      thread_external_id: input.thread_external_id,
      assigned_agent_id: null,
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
      ...(input.created_at ? { created_at: input.created_at } : {}),
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
      if (input.thread_external_id && isThreadGroupedChannel(input.channel)) {
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
  // Capacity must include this persisted case; concurrent deliveries use the same SQL lock.
  try {
    const agentId = await resolveAssignmentForConversation(db, {
      workspaceId: input.workspace_id,
      conversationId: created.id,
      channel: input.channel,
      contactId: input.contact_id,
      firstMessageText: input.firstMessageText ?? "",
    });
    created.assigned_agent_id = agentId;
  } catch (err) {
    console.error("[inbox-writer] assignment rules failed:", err);
  }
  return created as Conversation;
}
