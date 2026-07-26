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
import { attachmentFilename, fetchAttachmentBytes } from "../media-ingest";
import { safeLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { htmlToText } from "../html-to-text";
import {
  fetchOutlookMessage,
  fetchOutlookAttachments,
  getFreshAccessToken,
} from "./watch";

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
    });
    await sendDraft(accessToken, draft.id);
    return { externalMessageId: draft.internetMessageId, status: "sent" };
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
    await sendDraft(accessToken, draft.id);
    return { externalMessageId: draft.internetMessageId, status: "sent" };
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
      if (!expectedState || n.clientState !== expectedState) {
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
      events.push({
        channel: "outlook",
        connection,
        externalContactId: email,
        contactName: from?.name || undefined,
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
  args: { to: string; subject: string; convId: string | null; text: string },
): Promise<{ id: string; internetMessageId?: string }> {
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
          body: { contentType: "Text", content: args.text },
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
      body: { contentType: "Text", content: args.text },
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

async function sendDraft(accessToken: string, draftId: string): Promise<void> {
  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${draftId}/send`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!sendRes.ok && sendRes.status !== 202) {
    const detail = await sendRes.text().catch(() => "");
    throw new Error(`[outlook] send failed (${sendRes.status}): ${detail}`);
  }
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
