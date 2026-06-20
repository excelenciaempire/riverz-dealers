import type {
  ChannelAdapter,
  InboundEvent,
  OutboundText,
  ParsedWebhookContext,
  SendResult,
} from "../types";
import type { ChannelConnection } from "@/types";
import { supabaseAdmin } from "../admin-client";
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

    const subject = input.conversation.subject ?? "(no subject)";
    const convId = input.conversation.thread_external_id ?? null;

    // THREADING: a fresh draft can't carry a conversationId (Graph assigns
    // it server-side), so a plain create+send always started a NEW thread.
    // Instead, find any message already in this Outlook conversation and
    // `createReply` from it — Graph then keeps the reply in the same
    // thread. We overwrite the draft body + recipient and still capture
    // internetMessageId so the Sent-folder poller dedupes our own reply.
    const originalId = convId
      ? await findMessageIdInConversation(accessToken, convId)
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

      // Overwrite the auto-quoted body with our text and force the
      // recipient — createReply defaults `toRecipients` to the replied-to
      // message's sender, which is us when the only thread message so far
      // is one we sent. The PATCH response carries internetMessageId.
      const patchRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${draft.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            body: { contentType: "Text", content: input.text },
            toRecipients: [{ emailAddress: { address: to } }],
          }),
        },
      );
      if (!patchRes.ok) {
        const detail = await patchRes.text().catch(() => "");
        throw new Error(`[outlook] reply patch failed (${patchRes.status}): ${detail}`);
      }
      const patched = (await patchRes.json()) as { internetMessageId?: string };

      const sendRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`,
        { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!sendRes.ok && sendRes.status !== 202) {
        const detail = await sendRes.text().catch(() => "");
        throw new Error(`[outlook] reply send failed (${sendRes.status}): ${detail}`);
      }
      return { externalMessageId: patched.internetMessageId, status: "sent" };
    }

    // No prior message in the thread (agent-initiated first email) — fall
    // back to a standalone draft. Create-then-send (not /sendMail) so we
    // capture internetMessageId for Sent-folder dedup.
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
