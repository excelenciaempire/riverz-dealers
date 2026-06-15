import type {
  ChannelAdapter,
  InboundEvent,
  OutboundText,
  ParsedWebhookContext,
  SendResult,
} from "../types";
import type { ChannelConnection } from "@/types";
import { supabaseAdmin } from "../admin-client";
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
    const accessToken = await getFreshAccessToken(supabaseAdmin(), input.connection);
    if (!accessToken) throw new Error("[gmail] connection missing access_token");

    const to = input.contact.email || input.contact.external_id;
    if (!to) throw new Error("[gmail] contact missing email address");

    const subject = input.conversation.subject ?? "(no subject)";
    const raw = buildRfc2822({ from, to, subject, body: input.text, inReplyTo: input.replyToExternalId });
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

function buildRfc2822(args: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
}): string {
  const lines = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    args.inReplyTo ? `In-Reply-To: ${args.inReplyTo}` : "",
    args.inReplyTo ? `References: ${args.inReplyTo}` : "",
    "",
    args.body,
  ].filter(Boolean);
  return lines.join("\r\n");
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
