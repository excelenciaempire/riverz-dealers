import type { ChannelAdapter, InboundEvent, OutboundText, SendResult } from "../types";
import type { ChannelConnection } from "@/types";
import { decrypt } from "../encryption";
import { verifyMetaHandshake } from "../meta-webhook";

/**
 * Instagram ad / post comments via Graph API.
 *
 * Required config:
 *   - ig_user_id     — Instagram Professional account id
 *   - page_id        — Facebook page that owns the IG account
 *
 * Required secrets:
 *   - access_token   — page access token with
 *                      instagram_manage_comments + instagram_manage_messages
 *
 * Inbound events come on the IG `comments` webhook subscription.
 */
export const igCommentAdapter: ChannelAdapter = {
  channel: "ig_comment",
  label: "Instagram Comments",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.ig_user_id) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[ig_comment] connection missing access_token");
    const accessToken = decrypt(encrypted);

    const targetId = input.replyToExternalId ?? input.conversation.thread_external_id;
    if (!targetId) {
      throw new Error("[ig_comment] missing comment id to reply to");
    }

    const res = await fetch(`https://graph.facebook.com/v21.0/${targetId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: input.text, access_token: accessToken }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[ig_comment] reply failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as { id?: string };
    return { externalMessageId: json.id, status: "sent" };
  },

  async parseWebhook(req: Request, connection: ChannelConnection): Promise<InboundEvent[]> {
    const body = (await req.json()) as Record<string, unknown>;
    const events: InboundEvent[] = [];
    const entries = (body.entry as Array<Record<string, unknown>> | undefined) ?? [];
    for (const entry of entries) {
      const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? [];
      for (const c of changes) {
        if (c.field !== "comments") continue;
        const value = c.value as Record<string, unknown> | undefined;
        if (!value) continue;
        const fromObj = value.from as { id?: string; username?: string } | undefined;
        if (!fromObj?.id) continue;
        events.push({
          channel: "ig_comment",
          connection,
          externalContactId: fromObj.id,
          contactName: fromObj.username,
          externalMessageId: String(value.id ?? ""),
          text: String(value.text ?? ""),
          comment: {
            postId: String((value.media as { id?: string } | undefined)?.id ?? ""),
            parentCommentId: value.parent_id ? String(value.parent_id) : undefined,
          },
          // Meta's entry.time is Unix SECONDS; Date() wants ms.
          receivedAt: new Date(
            entry.time ? Number(entry.time) * 1000 : Date.now(),
          ).toISOString(),
          raw: c,
        });
      }
    }
    return events;
  },

  async verifyWebhookHandshake(req: Request, connection: ChannelConnection): Promise<string | null> {
    return verifyMetaHandshake(req, connection);
  },
};
