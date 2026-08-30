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
import { safeLocale } from "@/lib/i18n/server";
import { handleMetaGraphError } from "../meta-auth";
import { withAppsecretProofBody } from "../meta-graph";
import { supabaseAdmin } from "../admin-client";
import { buildSelfCommentEvent } from "../comment-echo";

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

    // Sin respaldo a `thread_external_id`: ahí vive el id del MEDIA, y
    // `POST /{media_id}/replies` devuelve 400. Ver fb_comment/adapter.ts.
    const targetId = input.replyToExternalId;
    if (!targetId) {
      throw new Error("[ig_comment] missing comment id to reply to");
    }

    const res = await fetch(`https://graph.facebook.com/v21.0/${targetId}/replies`, {
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
      await handleMetaGraphError(supabaseAdmin(), input.connection, res.status, parsed);
      console.error(`[ig_comment] reply failed (${res.status}): ${detail}`);
      throw new Error(describeMetaSendError("ig_comment", res.status, parsed, await safeLocale()).userMessage);
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
    // Our OWN account ids — un comentario nuestro nunca entra como "cliente".
    // Si es una RESPUESTA que el comercio escribió desde Instagram, en vez de
    // tirarla la guardamos como mensaje saliente del hilo de quien comentó
    // (buildSelfCommentEvent); si es un comentario suelto en su propio post,
    // se descarta como siempre.
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
        // `entry.time` es CUÁNDO LO ENTREGÓ META, no cuándo lo escribió la
        // persona. Facebook manda además `created_time` y ahí se prefiere ese
        // (ver fb_comment/adapter.ts); Instagram NO lo manda: el valor del
        // webhook de `comments` trae id, text, from, media y parent_id, y
        // nada más. Verificado sobre el payload real.
        //
        // Se podría pedirle la hora a Graph por cada comentario, pero eso es
        // una llamada extra en el camino caliente para corregir unos segundos
        // — y sólo se nota si Meta reintenta la entrega. No vale el precio.
        const receivedAt = new Date(
          entry.time ? Number(entry.time) * 1000 : Date.now(),
        ).toISOString();
        if (selfIds.has(String(fromObj.id))) {
          const self = await buildSelfCommentEvent(supabaseAdmin(), {
            channel: "ig_comment",
            connection,
            commentId: String(value.id ?? ""),
            parentCommentId: value.parent_id ? String(value.parent_id) : null,
            postId: String((value.media as { id?: string } | undefined)?.id ?? ""),
            text: String(value.text ?? ""),
            receivedAt,
          }).catch((err) => {
            console.error("[ig_comment] respuesta propia no sincronizada:", err);
            return null;
          });
          if (self) events.push(self);
          continue;
        }
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
          receivedAt,
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
