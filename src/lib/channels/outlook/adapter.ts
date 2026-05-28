import type { ChannelAdapter, InboundEvent, OutboundText, SendResult } from "../types";
import type { ChannelConnection } from "@/types";
import { supabaseAdmin } from "../admin-client";
import { fetchOutlookMessage, getFreshAccessToken } from "./watch";

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

    const subject = input.conversation.subject ?? "(no subject)";

    // Create a draft first so we capture the internetMessageId, then
    // send it. /sendMail returns 202 with no body, which left our
    // outbound rows id-less and unable to dedupe against the same mail
    // when the Sent-folder poller later ingests it. The draft id IS the
    // internetMessageId the Sent copy carries, so dedup works.
    const draftRes = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject,
        body: { contentType: "Text", content: input.text },
        toRecipients: [{ emailAddress: { address: to } }],
      }),
    });
    if (!draftRes.ok) {
      const detail = await draftRes.text().catch(() => "");
      throw new Error(`[outlook] draft create failed (${draftRes.status}): ${detail}`);
    }
    const draft = (await draftRes.json()) as { id?: string; internetMessageId?: string };
    if (!draft.id) throw new Error("[outlook] draft missing id");

    const sendRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!sendRes.ok && sendRes.status !== 202) {
      const detail = await sendRes.text().catch(() => "");
      throw new Error(`[outlook] send failed (${sendRes.status}): ${detail}`);
    }
    return { externalMessageId: draft.internetMessageId, status: "sent" };
  },

  async parseWebhook(req: Request, connection: ChannelConnection): Promise<InboundEvent[]> {
    const body = (await req.json().catch(() => null)) as
      | { value?: GraphNotification[] }
      | null;
    const notifications = body?.value ?? [];
    if (notifications.length === 0) return [];

    const expectedState = process.env.OUTLOOK_PUSH_CLIENT_STATE;
    const admin = supabaseAdmin();
    const accessToken = await getFreshAccessToken(admin, connection);
    if (!accessToken) return [];

    const events: InboundEvent[] = [];
    for (const n of notifications) {
      // Reject anything not carrying our shared secret — Graph echoes
      // the clientState we set at subscription time.
      if (expectedState && n.clientState && n.clientState !== expectedState) {
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
      events.push({
        channel: "outlook",
        connection,
        externalContactId: email,
        contactName: from?.name || undefined,
        externalMessageId: msg.internetMessageId || msg.id,
        externalThreadId: msg.conversationId,
        subject: msg.subject ?? "",
        text: text || stripHtml(html) || msg.bodyPreview || "",
        htmlBody: html || undefined,
        receivedAt: msg.receivedDateTime ?? new Date().toISOString(),
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

/** "Users/{uid}/Messages/{mid}" or "/me/messages/{mid}" → {mid}. */
function extractMessageId(resource: string): string {
  const m = resource.match(/[Mm]essages[/(']([^/)']+)/);
  return m ? m[1] : "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
