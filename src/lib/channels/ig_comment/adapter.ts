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
import { describeMetaSendError, parseMetaError } from "../meta-errors";
import { handleMetaGraphError } from "../meta-auth";
import { supabaseAdmin } from "../admin-client";

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
      const parsed = parseMetaError(detail);
      await handleMetaGraphError(supabaseAdmin(), input.connection, res.status, parsed);
      console.error(`[ig_comment] reply failed (${res.status}): ${detail}`);
      throw new Error(describeMetaSendError("ig_comment", res.status, parsed).userMessage);
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
    // Our OWN account ids — skip comments the business makes on its own
    // posts / replies it leaves, so it isn't ingested as a "customer".
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    const selfIds = new Set(
      [String(cfg.ig_user_id ?? ""), String(cfg.page_id ?? "")].filter(Boolean),
    );
    for (const entry of entries) {
      const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? [];
      for (const c of changes) {
        if (c.field !== "comments") continue;
        const value = c.value as Record<string, unknown> | undefined;
        if (!value) continue;
        const fromObj = value.from as { id?: string; username?: string } | undefined;
        if (!fromObj?.id) continue;
        if (selfIds.has(String(fromObj.id))) continue;
        // Render IG handles as "@usuario" — matches how IG DMs and the
        // meta-contact-names backfill cron store them, so the same person
        // reads consistently whether they DM'd or commented (and the
        // inbox-writer name backfill doesn't flip "@usuario" back to
        // the bare handle on the next comment).
        const username = fromObj.username?.trim();
        events.push({
          channel: "ig_comment",
          connection,
          externalContactId: fromObj.id,
          contactName: username ? `@${username}` : undefined,
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
