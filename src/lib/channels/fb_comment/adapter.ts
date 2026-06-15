import type {
  ChannelAdapter,
  InboundEvent,
  OutboundText,
  ParsedWebhookContext,
  SendResult,
} from "../types";
import type { ChannelConnection } from "@/types";
import { decrypt } from "../encryption";
import { verifyMetaHandshake } from "../meta-webhook";

/**
 * Facebook ad / post comments via Graph API.
 *
 * Required config:
 *   - page_id        — connected page id
 *   - subscribe_fields: ["feed"]   — Page webhook subscription
 *
 * Required secrets:
 *   - access_token   — page access token (pages_read_engagement +
 *                      pages_manage_engagement)
 *
 * Inbound events carry the post/ad id in `comment.adId` / `comment.postId`
 * so the unified inbox can group threads.
 */
export const fbCommentAdapter: ChannelAdapter = {
  channel: "fb_comment",
  label: "Facebook Comments",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.page_id) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[fb_comment] connection missing access_token");
    const accessToken = decrypt(encrypted);

    // Reply target is the original comment id, which we stash in
    // conversation.thread_external_id when the inbound event creates
    // the conversation row.
    const targetId = input.replyToExternalId ?? input.conversation.thread_external_id;
    if (!targetId) {
      throw new Error("[fb_comment] missing comment id to reply to");
    }

    const res = await fetch(`https://graph.facebook.com/v21.0/${targetId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: input.text, access_token: accessToken }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[fb_comment] reply failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as { id?: string };
    return { externalMessageId: json.id, status: "sent" };
  },

  async parseWebhook(
    ctx: ParsedWebhookContext,
    connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    const body = (ctx.payload ?? {}) as Record<string, unknown>;
    const events: InboundEvent[] = [];
    const entries = (body.entry as Array<Record<string, unknown>> | undefined) ?? [];
    for (const entry of entries) {
      const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? [];
      for (const c of changes) {
        if (c.field !== "feed") continue;
        const value = c.value as Record<string, unknown> | undefined;
        if (!value || value.item !== "comment" || value.verb !== "add") continue;
        const fromObj = value.from as { id?: string; name?: string } | undefined;
        if (!fromObj?.id) continue;
        events.push({
          channel: "fb_comment",
          connection,
          externalContactId: fromObj.id,
          contactName: fromObj.name,
          externalMessageId: String(value.comment_id ?? ""),
          text: String(value.message ?? ""),
          comment: {
            postId: String(value.post_id ?? ""),
            parentCommentId: value.parent_id ? String(value.parent_id) : undefined,
            adId: value.ad_id ? String(value.ad_id) : undefined,
            permalink: value.permalink_url ? String(value.permalink_url) : undefined,
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
