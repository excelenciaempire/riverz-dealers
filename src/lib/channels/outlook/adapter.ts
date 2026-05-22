import type { ChannelAdapter, InboundEvent, OutboundText, SendResult } from "../types";
import type { ChannelConnection } from "@/types";
import { decrypt } from "../encryption";

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
    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[outlook] connection missing access_token");
    const accessToken = decrypt(encrypted);

    const to = input.contact.email || input.contact.external_id;
    if (!to) throw new Error("[outlook] contact missing email address");

    const subject = input.conversation.subject ?? "(no subject)";

    const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "Text", content: input.text },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok && res.status !== 202) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[outlook] send failed (${res.status}): ${detail}`);
    }
    // Graph sendMail returns 202 without a body — we don't get the
    // immutable id until the message lands in Sent Items. The webhook
    // backfills the externalMessageId when the "sent" notification
    // arrives.
    return { status: "sent" };
  },

  async parseWebhook(req: Request, connection: ChannelConnection): Promise<InboundEvent[]> {
    // Graph subscription handshake — Phase 6 implements the full
    // change-notification → me/messages/{id} fetch flow.
    void req;
    void connection;
    return [];
  },

  async verifyWebhookHandshake(req: Request, _connection: ChannelConnection): Promise<string | null> {
    // Microsoft Graph subscription handshake — Graph posts a token
    // in the `validationToken` query string and expects an immediate
    // text/plain echo.
    const url = new URL(req.url);
    return url.searchParams.get("validationToken");
  },
};
