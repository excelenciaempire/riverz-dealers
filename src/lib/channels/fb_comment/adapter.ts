import type {
  ChannelAdapter,
  InboundEvent,
  OutboundText,
  ParsedWebhookContext,
  SendResult,
} from "../types";
import type { ChannelConnection, MessageAttachment } from "@/types";
import { decrypt } from "../encryption";
import { verifyMetaHandshake } from "../meta-webhook";
import { ingestMetaAttachment } from "../media-ingest";
import { describeMetaSendError, parseMetaError } from "../meta-errors";
import { safeLocale } from "@/lib/i18n/server";
import { handleMetaGraphError } from "../meta-auth";
import { withAppsecretProofBody } from "../meta-graph";
import { supabaseAdmin } from "../admin-client";
import { applyCommentLifecycle } from "../comment-sync";
import { buildSelfCommentEvent } from "../comment-echo";

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
      body: JSON.stringify(
        withAppsecretProofBody(
          { message: input.text, access_token: accessToken },
          accessToken,
        ),
      ),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const parsed = parseMetaError(detail);
      // Flip the connection to error on a genuine token death (so Settings
      // › Canales shows a Reconectar CTA) — same as the DM adapters.
      await handleMetaGraphError(supabaseAdmin(), input.connection, res.status, parsed);
      // Log Meta's raw body server-side; surface a clear localized message.
      console.error(`[fb_comment] reply failed (${res.status}): ${detail}`);
      throw new Error(describeMetaSendError("fb_comment", res.status, parsed, await safeLocale()).userMessage);
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
    // Our OWN page id — skip comments/replies the page leaves itself so it
    // isn't ingested as a "customer".
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    const selfIds = new Set([String(cfg.page_id ?? "")].filter(Boolean));
    for (const entry of entries) {
      const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? [];
      for (const c of changes) {
        if (c.field !== "feed") continue;
        const value = c.value as Record<string, unknown> | undefined;
        if (!value || value.item !== "comment") continue;
        const verb = String(value.verb ?? "");
        // Lifecycle events — a comment removed / hidden / unhidden / edited
        // natively on Facebook. Reflect it in the inbox and move on; these are
        // not new inbound messages. (Instagram has no equivalent webhook, so IG
        // relies on the reconcile cron.)
        if (verb !== "add") {
          const commentId = String(value.comment_id ?? "");
          const kind =
            verb === "remove" || verb === "delete"
              ? ("delete" as const)
              : verb === "hide"
                ? ("hide" as const)
                : verb === "unhide"
                  ? ("unhide" as const)
                  : verb === "edited" || verb === "edit"
                    ? ("edit" as const)
                    : null;
          if (commentId && kind) {
            await applyCommentLifecycle(supabaseAdmin(), {
              channel: "fb_comment",
              workspaceId: connection.workspace_id,
              commentExternalId: commentId,
              kind,
              text: kind === "edit" ? String(value.message ?? "") : undefined,
            }).catch((e) => console.error("[fb_comment] lifecycle failed:", e));
          }
          continue;
        }
        const fromObj = value.from as { id?: string; name?: string } | undefined;
        if (!fromObj?.id) continue;
        if (selfIds.has(String(fromObj.id))) {
          // Una respuesta que el comercio escribió desde Facebook: va al hilo
          // de quien comentó como mensaje saliente, no se descarta.
          const self = await buildSelfCommentEvent(supabaseAdmin(), {
            channel: "fb_comment",
            connection,
            commentId: String(value.comment_id ?? ""),
            parentCommentId: value.parent_id ? String(value.parent_id) : null,
            postId: value.post_id ? String(value.post_id) : null,
            text: String(value.message ?? ""),
            receivedAt: new Date(
              value.created_time
                ? Number(value.created_time) * 1000
                : entry.time
                  ? Number(entry.time) * 1000
                  : Date.now(),
            ).toISOString(),
          }).catch((err) => {
            console.error("[fb_comment] respuesta propia no sincronizada:", err);
            return null;
          });
          if (self) events.push(self);
          continue;
        }
        // Un comentario puede venir con foto (`value.photo`), video o GIF
        // (`value.video`) o un sticker (`value.sticker`). Los re-hospedamos en
        // Storage para que se vean en la bandeja — las URL del CDN caducan.
        // Antes sólo se guardaba la foto: un comentario con video o sticker
        // quedaba como burbuja vacía.
        const mediaUrl =
          typeof value.photo === "string"
            ? { url: value.photo, kind: "image" as const }
            : typeof value.video === "string"
              ? { url: value.video, kind: "video" as const }
              : typeof value.sticker === "string"
                ? { url: value.sticker, kind: "image" as const }
                : null;
        let attachments: MessageAttachment[] | undefined;
        if (mediaUrl) {
          const ingested = await ingestMetaAttachment({
            attachmentUrl: mediaUrl.url,
            workspaceId: connection.workspace_id,
            conversationId: fromObj.id,
            externalMessageId: String(value.comment_id ?? ""),
            hintedKind: mediaUrl.kind,
          });
          if (ingested) {
            attachments = [
              {
                url: ingested.url,
                mime_type: ingested.mediaMime,
                size: ingested.mediaSize,
              },
            ];
          }
        }
        events.push({
          channel: "fb_comment",
          connection,
          externalContactId: fromObj.id,
          contactName: fromObj.name,
          externalMessageId: String(value.comment_id ?? ""),
          text: String(value.message ?? ""),
          attachments,
          comment: {
            postId: String(value.post_id ?? ""),
            parentCommentId: value.parent_id ? String(value.parent_id) : undefined,
            adId: value.ad_id ? String(value.ad_id) : undefined,
            permalink: value.permalink_url ? String(value.permalink_url) : undefined,
          },
          // Prefer the comment's own created_time (the precise moment the
          // customer posted it) over entry.time (when Meta delivered the
          // webhook — usually close, but can lag on retries). Both are
          // Unix SECONDS; Date() wants ms.
          receivedAt: new Date(
            value.created_time
              ? Number(value.created_time) * 1000
              : entry.time
                ? Number(entry.time) * 1000
                : Date.now(),
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
