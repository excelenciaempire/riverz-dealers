import type {
  ChannelAdapter,
  InboundEvent,
  OutboundMedia,
  OutboundText,
  ParsedWebhookContext,
  SendResult,
} from "../types";
import type { ChannelConnection } from "@/types";
import { supabaseAdmin } from "../admin-client";
import { conFirma } from "../firma-de-correo";
import { getLogger } from "@/lib/log/logger";
import { attachmentFilename, fetchAttachmentBytes } from "../media-ingest";
import { timingSafeStringEqual } from "../verify-webhook";
import { safeLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { htmlToText } from "../html-to-text";
import { detectAutomatedSender } from "../email/automated-sender";
import {
  fetchOutlookMessage,
  fetchOutlookAttachments,
  getFreshAccessToken,
} from "./watch";

const log = getLogger("channels.outlook");

/**
 * Outlook / Hotmail via Microsoft Graph (OAuth 2.0, scope Mail.Send +
 * Mail.ReadWrite). Works for personal Outlook/Hotmail and Microsoft 365
 * mailboxes alike — same Graph endpoint.
 *
 * Required config:
 *   - email
 *   - subscription_id  — Graph webhook subscription id (renewed every 3 days)
 * Required secrets:
 *   - access_token, refresh_token
 */
export const outlookAdapter: ChannelAdapter = {
  channel: "outlook",
  label: "Outlook / Hotmail",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.email) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    // Refresh the Graph token if the cached one expired (~1h lifetime).
    const accessToken = await getFreshAccessToken(supabaseAdmin(), input.connection);
    if (!accessToken) throw new Error("[outlook] connection missing access_token");

    const to = input.contact.email || input.contact.external_id;
    if (!to) throw new Error("[outlook] contact missing email address");

    const draft = await createDraft(accessToken, {
      to,
      subject: input.conversation.subject ?? "(no subject)",
      convId: input.conversation.thread_external_id ?? null,
      text: input.text,
      connection: input.connection,
    });
    const enviado = await sendDraft(accessToken, draft.id, draft.internetMessageId);
    return { externalMessageId: enviado, status: "sent" };
  },

  /**
   * Responder adjuntando un archivo. Graph sube el adjunto AL BORRADOR y
   * recién ahí se envía, así el correo sale con el archivo dentro (no como
   * enlace) y sigue en el mismo hilo que la respuesta de texto.
   */
  async sendMedia(input: OutboundMedia): Promise<SendResult> {
    const locale = await safeLocale();
    const accessToken = await getFreshAccessToken(supabaseAdmin(), input.connection);
    if (!accessToken) throw new Error("[outlook] connection missing access_token");

    const to = input.contact.email || input.contact.external_id;
    if (!to) throw new Error("[outlook] contact missing email address");

    const file = await fetchAttachmentBytes(input.mediaUrl);
    if (!file) throw new Error(translate(locale, "errInbox.attachmentUnreadable"));
    // Por encima de 3 MB Graph exige una sesión de subida por partes; se
    // avisa el límite en vez de fallar con un error opaco de Microsoft.
    if (file.buffer.length > GRAPH_ATTACHMENT_MAX_BYTES) {
      throw new Error(translate(locale, "errInbox.attachmentTooLargeGraph"));
    }

    const draft = await createDraft(accessToken, {
      to,
      subject: input.conversation.subject ?? "(no subject)",
      convId: input.conversation.thread_external_id ?? null,
      text: input.caption ?? "",
      connection: input.connection,
    });
    const attachRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${draft.id}/attachments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: input.filename || attachmentFilename(input.mediaUrl, file.mime),
          contentType: file.mime,
          contentBytes: file.buffer.toString("base64"),
        }),
      },
    );
    if (!attachRes.ok) {
      const detail = await attachRes.text().catch(() => "");
      throw new Error(`[outlook] attach failed (${attachRes.status}): ${detail}`);
    }
    const enviado = await sendDraft(accessToken, draft.id, draft.internetMessageId);
    return { externalMessageId: enviado, status: "sent" };
  },

  async parseWebhook(
    ctx: ParsedWebhookContext,
    connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    const body = ctx.payload as { value?: GraphNotification[] } | null;
    const notifications = body?.value ?? [];
    if (notifications.length === 0) return [];

    const expectedState = process.env.OUTLOOK_PUSH_CLIENT_STATE;
    const admin = supabaseAdmin();
    const accessToken = await getFreshAccessToken(admin, connection);
    if (!accessToken) return [];

    const events: InboundEvent[] = [];
    for (const n of notifications) {
      // Reject anything not carrying our shared secret — Graph echoes
      // the clientState we set at subscription time. Fail CLOSED: skip
      // unless OUTLOOK_PUSH_CLIENT_STATE is set AND the notification's
      // clientState matches it.
      //
      // Este descarte se loguea SIEMPRE. Antes era un `continue` mudo, y ese
      // silencio costó caro: una suscripción creada con un clientState viejo
      // (el renovador solo extiende la fecha, nunca reescribe el secreto ni la
      // URL) sigue viéndose perfectamente sana en Graph mientras cada aviso
      // que llega se tira aquí. El correo pasaba a entrar solo por el sondeo y
      // no quedaba un solo rastro de por qué.
      // Comparación en tiempo constante, como el resto de los secretos del
      // sistema: `!==` sale en el primer byte distinto y el tiempo de
      // respuesta deja adivinar el valor carácter a carácter.
      if (!expectedState || !timingSafeStringEqual(n.clientState ?? "", expectedState)) {
        log.warn("outlook notification dropped — clientState mismatch", {
          connectionId: connection.id,
          subscriptionId: n.subscriptionId,
          hasExpectedState: !!expectedState,
          notificationHasState: !!n.clientState,
          // Nunca el secreto: solo lo justo para distinguir "no coincide" de
          // "no vino" al leer los registros.
          suppliedLength: n.clientState?.length ?? 0,
        });
        continue;
      }
      const graphId = extractMessageId(n.resource ?? "") || n.resourceData?.id;
      if (!graphId) continue;

      const msg = await fetchOutlookMessage(accessToken, graphId);
      if (!msg) continue;

      const from = msg.from?.emailAddress;
      const email = from?.address?.toLowerCase();
      if (!email) continue;

      const html = msg.body?.contentType === "html" ? msg.body.content ?? "" : "";
      const text = msg.body?.contentType === "text" ? msg.body.content ?? "" : "";
      const attachments = msg.hasAttachments
        ? await fetchOutlookAttachments(
            accessToken,
            msg.id,
            connection.workspace_id,
            email,
          )
        : [];
      // El aviso de Graph llega por otro camino que el sondeo, así que el
      // filtro de remitentes automáticos tiene que estar en los dos.
      const machine = detectAutomatedSender({
        from: email,
        subject: msg.subject,
        headers: msg.internetMessageHeaders,
      });
      if (machine.automated) {
        log.info("remitente automático: entra a la bandeja, no se responde solo", {
          connectionId: connection.id,
          from: email,
          reason: machine.reason,
        });
      }
      events.push({
        channel: "outlook",
        connection,
        externalContactId: email,
        contactName: from?.name || undefined,
        suppressAutoReply: machine.automated || undefined,
        externalMessageId: msg.internetMessageId || msg.id,
        externalThreadId: msg.conversationId,
        subject: msg.subject ?? "",
        text: text || htmlToText(html) || msg.bodyPreview || "",
        htmlBody: html || undefined,
        receivedAt: msg.receivedDateTime ?? new Date().toISOString(),
        attachments: attachments.length ? attachments : undefined,
        raw: { graphId: msg.id },
      });
    }
    return events;
  },

  async verifyWebhookHandshake(req: Request, _connection: ChannelConnection): Promise<string | null> {
    // Microsoft Graph subscription handshake — Graph posts a token
    // in the `validationToken` query string and expects an immediate
    // text/plain echo.
    const url = new URL(req.url);
    return url.searchParams.get("validationToken");
  },
};

interface GraphNotification {
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
  resource?: string;
  resourceData?: { id?: string };
}

/**
 * Find any message Graph id in a given Outlook conversation so we can
 * `createReply` from it and keep our reply in the same thread. Returns
 * null when the conversation has no readable message (e.g. the agent is
 * emailing first) — the caller then falls back to a standalone draft.
 */
/** Tope de `fileAttachment` en Graph: por encima hace falta una sesión de
 *  subida por partes, que no vale la pena para un adjunto de bandeja. */
const GRAPH_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Borrador listo para enviar, en el hilo correcto.
 *
 * THREADING: un borrador nuevo no puede llevar conversationId (lo asigna
 * Graph), así que crear+enviar arrancaba SIEMPRE un hilo nuevo. Por eso, si
 * ya hay un mensaje en esa conversación, se usa `createReply` sobre él y se
 * sobreescriben cuerpo y destinatario — `createReply` pone como destinatario
 * al remitente del mensaje respondido, que somos nosotros cuando lo único que
 * hay en el hilo es algo que enviamos. Se devuelve internetMessageId para que
 * el poller de Enviados deduplique nuestra propia respuesta.
 */
async function createDraft(
  accessToken: string,
  args: {
    to: string;
    subject: string;
    convId: string | null;
    text: string;
    /** El pie del buzón, si el comercio puso uno. */
    connection?: ChannelConnection;
  },
): Promise<{ id: string; internetMessageId?: string }> {
  const cuerpo = args.connection ? conFirma(args.text, args.connection) : args.text;
  const originalId = args.convId
    ? await findMessageIdInConversation(accessToken, args.convId)
    : null;

  if (originalId) {
    const replyRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${originalId}/createReply`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!replyRes.ok) {
      const detail = await replyRes.text().catch(() => "");
      throw new Error(`[outlook] createReply failed (${replyRes.status}): ${detail}`);
    }
    const draft = (await replyRes.json()) as { id?: string };
    if (!draft.id) throw new Error("[outlook] reply draft missing id");

    const patchRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${draft.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          body: { contentType: "Text", content: cuerpo },
          toRecipients: [{ emailAddress: { address: args.to } }],
        }),
      },
    );
    if (!patchRes.ok) {
      const detail = await patchRes.text().catch(() => "");
      throw new Error(`[outlook] reply patch failed (${patchRes.status}): ${detail}`);
    }
    const patched = (await patchRes.json()) as { internetMessageId?: string };
    return { id: draft.id, internetMessageId: patched.internetMessageId };
  }

  // Sin mensajes previos en el hilo (el agente escribe primero): borrador
  // suelto. Crear-y-enviar (no /sendMail) para capturar internetMessageId.
  const draftRes = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      subject: args.subject,
      body: { contentType: "Text", content: cuerpo },
      toRecipients: [{ emailAddress: { address: args.to } }],
    }),
  });
  if (!draftRes.ok) {
    const detail = await draftRes.text().catch(() => "");
    throw new Error(`[outlook] draft create failed (${draftRes.status}): ${detail}`);
  }
  const draft = (await draftRes.json()) as { id?: string; internetMessageId?: string };
  if (!draft.id) throw new Error("[outlook] draft missing id");
  return { id: draft.id, internetMessageId: draft.internetMessageId };
}

/**
 * Manda el borrador y devuelve el id DEFINITIVO del correo.
 *
 * Por qué no alcanza con el del borrador: Graph puede reasignar el
 * `internetMessageId` al enviar. Guardando el del borrador, el recorrido de la
 * carpeta "Enviados" traía el mismo correo con OTRO id, no lo reconocía como
 * ya guardado —la conciliación de marcadores sólo actúa cuando `message_id`
 * está en null— y el hilo mostraba la misma respuesta dos veces.
 *
 * Al enviarse, el mensaje se mueve a Enviados y su id de Graph cambia, así que
 * se lo busca por `conversationId`. Si no se lo encuentra queda el del
 * borrador, que es lo que había antes: peor, pero no roto.
 */
async function sendDraft(
  accessToken: string,
  draftId: string,
  fallbackInternetMessageId?: string,
): Promise<string | undefined> {
  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${draftId}/send`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!sendRes.ok && sendRes.status !== 202) {
    const detail = await sendRes.text().catch(() => "");
    throw new Error(`[outlook] send failed (${sendRes.status}): ${detail}`);
  }
  try {
    const u = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages");
    u.searchParams.set("$select", "internetMessageId");
    u.searchParams.set("$top", "1");
    u.searchParams.set("$orderby", "sentDateTime desc");
    const r = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (r.ok) {
      const j = (await r.json()) as { value?: Array<{ internetMessageId?: string }> };
      const real = j.value?.[0]?.internetMessageId;
      if (real) return real;
    }
  } catch {
    /* mejor el del borrador que ninguno */
  }
  return fallbackInternetMessageId;
}


async function findMessageIdInConversation(
  accessToken: string,
  conversationId: string,
): Promise<string | null> {
  const u = new URL("https://graph.microsoft.com/v1.0/me/messages");
  // OData string literals escape a single quote by doubling it.
  u.searchParams.set(
    "$filter",
    `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
  );
  u.searchParams.set("$select", "id");
  u.searchParams.set("$top", "1");
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { value?: Array<{ id?: string }> };
  return j.value?.[0]?.id ?? null;
}

/** "Users/{uid}/Messages/{mid}" or "/me/messages/{mid}" → {mid}. */
function extractMessageId(resource: string): string {
  const m = resource.match(/[Mm]essages[/(']([^/)']+)/);
  return m ? m[1] : "";
}
