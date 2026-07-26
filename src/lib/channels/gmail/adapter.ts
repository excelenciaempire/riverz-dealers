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
import { getFreshAccessToken } from "./watch";

/**
 * Gmail via Google API (OAuth 2.0, scope gmail.send + gmail.readonly +
 * gmail.modify for label management).
 *
 * Required config:
 *   - email           — connected mailbox address
 *   - history_id      — last processed Gmail history id (poll cursor)
 *   - watch_topic     — Pub/Sub topic for push notifications (optional)
 *
 * Required secrets:
 *   - access_token, refresh_token  (encrypted, refreshed on 401)
 */
export const gmailAdapter: ChannelAdapter = {
  channel: "gmail",
  label: "Gmail",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.email) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    // Connections created before the OAuth callback started writing
    // `config.email` still have it on `external_account_id`. Fall back
    // there so older Gmail rows can send without a forced reconnect.
    const from = String(cfg.email ?? input.connection.external_account_id ?? "");
    if (!from) throw new Error("[gmail] connection missing email");

    // Refresh the access token if the cached one has expired (Google
    // tokens live ~1h). Without this, replies started failing with 401
    // an hour after connecting and the agent's text was lost.
    const admin = supabaseAdmin();
    const accessToken = await getFreshAccessToken(admin, input.connection);
    if (!accessToken) throw new Error("[gmail] connection missing access_token");

    const to = input.contact.email || input.contact.external_id;
    if (!to) throw new Error("[gmail] contact missing email address");

    // Thread the reply. Gmail keeps a message in an existing thread only
    // when (a) threadId is set, (b) the Subject matches (it ignores the
    // "Re:" prefix), AND (c) In-Reply-To / References point at a message
    // already in the thread. We had threadId but only set In-Reply-To
    // when the composer passed an explicit target — so normal replies
    // could split into a new thread. Fall back to the most recent inbound
    // message's RFC Message-ID so every reply stays threaded.
    const replyId =
      input.replyToExternalId ??
      (await latestInboundMessageId(admin, input.conversation.id));

    const subject = withRePrefix(input.conversation.subject ?? "(no subject)");
    const raw = buildRfc2822({ from, to, subject, body: input.text, inReplyTo: replyId });
    const b64 = base64UrlEncode(raw);

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        raw: b64,
        threadId: input.conversation.thread_external_id ?? undefined,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[gmail] send failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as { id?: string };
    return { externalMessageId: json.id, status: "sent" };
  },

  /**
   * Responder adjuntando un archivo. El adjunto viaja DENTRO del correo
   * (multipart/mixed), que es como lo espera cualquier cliente de mail — no
   * como un enlace. El texto que escribió el agente va como cuerpo.
   */
  async sendMedia(input: OutboundMedia): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const from = String(cfg.email ?? input.connection.external_account_id ?? "");
    if (!from) throw new Error("[gmail] connection missing email");

    const admin = supabaseAdmin();
    const accessToken = await getFreshAccessToken(admin, input.connection);
    if (!accessToken) throw new Error("[gmail] connection missing access_token");

    const to = input.contact.email || input.contact.external_id;
    if (!to) throw new Error("[gmail] contact missing email address");

    const file = await fetchAttachmentBytes(input.mediaUrl);
    if (!file) {
      throw new Error(translate(await safeLocale(), "errInbox.attachmentUnreadable"));
    }

    const replyId =
      input.replyToExternalId ??
      (await latestInboundMessageId(admin, input.conversation.id));
    const subject = withRePrefix(input.conversation.subject ?? "(no subject)");
    const raw = buildRfc2822({
      from,
      to,
      subject,
      body: input.caption ?? "",
      inReplyTo: replyId,
      attachment: {
        filename: input.filename || attachmentFilename(input.mediaUrl, file.mime),
        mime: file.mime,
        content: file.buffer,
      },
    });

    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        raw: base64UrlEncode(raw),
        threadId: input.conversation.thread_external_id ?? undefined,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[gmail] send media failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as { id?: string };
    return { externalMessageId: json.id, status: "sent" };
  },

  async parseWebhook(
    ctx: ParsedWebhookContext,
    connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    // Gmail push notifications (Pub/Sub) deliver only the history id —
    // the adapter then fetches changes via history.list. The full
    // implementation lives in Phase 6; we accept the ping here so the
    // endpoint shape is right.
    void ctx;
    void connection;
    return [];
  },
};

/** Most recent inbound (customer) message's external id in the
 *  conversation — for Gmail that's the RFC Message-ID header, exactly
 *  what In-Reply-To / References need. undefined when the agent emails
 *  first (no inbound to thread off). */
async function latestInboundMessageId(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
): Promise<string | undefined> {
  const { data } = await db
    .from("messages")
    .select("message_id")
    .eq("conversation_id", conversationId)
    .eq("sender_type", "customer")
    .not("message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { message_id?: string } | null)?.message_id ?? undefined;
}

/** Prefix "Re: " unless it's already there — keeps the threaded subject
 *  conventional without doubling on a reply-to-a-reply. */
function withRePrefix(subject: string): string {
  return /^\s*re:/i.test(subject) ? subject : `Re: ${subject}`;
}

/**
 * Neutraliza header injection (CRLF): el subject y el email del contacto
 * provienen de correo entrante controlado por el remitente. Sin esto, un
 * `Subject: Hola\r\nBcc: atacante@evil.com` inyectaría cabeceras nuevas (o
 * con `\r\n\r\n` un cuerpo/MIME falso) cuando Gmail interpreta el RFC2822
 * crudo. Aplicar SOLO a valores de cabecera, nunca al body.
 */
function sanitizeHeader(value: string): string {
  return String(value).replace(/[\r\n ]+/g, " ").trim();
}

function buildRfc2822(args: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  /** Cuando viene, el correo se arma multipart/mixed: cuerpo + archivo. */
  attachment?: { filename: string; mime: string; content: Buffer };
}): string {
  const headers = [
    `From: ${sanitizeHeader(args.from)}`,
    `To: ${sanitizeHeader(args.to)}`,
    `Subject: ${sanitizeHeader(args.subject)}`,
    "MIME-Version: 1.0",
    args.inReplyTo ? `In-Reply-To: ${sanitizeHeader(args.inReplyTo)}` : "",
    args.inReplyTo ? `References: ${sanitizeHeader(args.inReplyTo)}` : "",
  ].filter(Boolean);

  if (!args.attachment) {
    return [...headers, "Content-Type: text/plain; charset=UTF-8", "", args.body].join(
      "\r\n",
    );
  }

  // Frontera fija y sin caracteres especiales: el contenido va en base64, así
  // que no puede colisionar con ella.
  const boundary = "riverz-mixed-boundary";
  const name = sanitizeHeader(args.attachment.filename).replace(/"/g, "");
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    args.body,
    "",
    `--${boundary}`,
    `Content-Type: ${sanitizeHeader(args.attachment.mime)}; name="${name}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${name}"`,
    "",
    chunk76(args.attachment.content.toString("base64")),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** base64 en líneas de 76 caracteres, como pide RFC 2045. */
function chunk76(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}


function base64UrlEncode(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
