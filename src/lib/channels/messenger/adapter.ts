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
import { composeMetaText, ingestMetaAttachments } from "../meta-attachments";
import { handleMetaReaction, type MetaReactionEvent } from "../meta-reactions";
import { handleMetaGraphError, clearMetaConnectionError } from "../meta-auth";
import { describeMetaSendError, parseMetaError } from "../meta-errors";
import { safeLocale } from "@/lib/i18n/server";
import { buildParticipantMap } from "../meta-participants";
import { withAppsecretProof, withAppsecretProofBody } from "../meta-graph";
import { supabaseAdmin } from "../admin-client";

/**
 * Map a Meta Messenger/Instagram `referral` (or postback.referral) to the
 * shared InboundEvent.referral shape when it's a click-to-Messenger AD. Returns
 * undefined for non-ad refs (m.me links, plain refs) so we only stamp real ad
 * context. Best-effort: if Meta's shape differs, we return undefined and the
 * banner simply doesn't show — never throws.
 */
export function mapMetaAdReferral(ref: unknown): InboundEvent["referral"] | undefined {
  if (!ref || typeof ref !== "object") return undefined;
  const r = ref as Record<string, unknown>;
  const ctx = (r.ads_context_data ?? {}) as Record<string, unknown>;
  const adId = r.ad_id ?? r.source_id;
  const headline = typeof ctx.ad_title === "string" ? ctx.ad_title : undefined;
  if (adId == null && !headline) return undefined;
  return {
    sourceType: typeof r.source === "string" ? r.source : "ADS",
    sourceId: adId != null ? String(adId) : undefined,
    ctwaClid: typeof r.ref === "string" ? r.ref : undefined,
    headline,
    mediaType: ctx.video_url ? "video" : ctx.photo_url ? "image" : undefined,
  };
}

/**
 * Facebook Messenger via Meta Graph API (Send API).
 *
 * Required config:
 *   - page_id      — Facebook page id
 * Required secret:
 *   - access_token — Page access token (pages_messaging)
 */
export const messengerAdapter: ChannelAdapter = {
  channel: "messenger",
  label: "Facebook Messenger",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.page_id) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const pageId = String(cfg.page_id ?? "");
    if (!pageId) throw new Error("[messenger] connection missing page_id");

    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[messenger] connection missing access_token");
    const accessToken = decrypt(encrypted);

    // Two recipient shapes (mirrors the Instagram adapter):
    //  - PRIVATE REPLY to a comment: `recipient: { comment_id }`. Required to
    //    DM someone who only commented on a post/ad — we don't have their PSID
    //    until they reply, so a plain `{ id }` send is impossible. This is what
    //    powers comment-to-DM (Settings › Comentario a DM).
    //  - Normal DM (the user messaged us first): `recipient: { id: PSID }`.
    const recipient = input.commentId
      ? { comment_id: input.commentId }
      : input.contact.external_id
        ? { id: input.contact.external_id }
        : null;
    if (!recipient) {
      throw new Error(
        "[messenger] no recipient — contact missing external_id (PSID) and no comment_id",
      );
    }

    const graphUrl = `https://graph.facebook.com/v21.0/${pageId}/messages`;
    const send = (useHumanAgentTag: boolean): Promise<Response> =>
      fetch(graphUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          withAppsecretProofBody(
            {
              recipient,
              ...(useHumanAgentTag
                ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }
                : { messaging_type: "RESPONSE" }),
              message: { text: input.text },
              access_token: accessToken,
            },
            accessToken,
          ),
        ),
      });

    let res = await send(false);
    let detail = res.ok ? "" : await res.text().catch(() => "");
    // A human agent replying to a normal DM outside Meta's 24h window is
    // rejected as outside-window. Retry once with the HUMAN_AGENT tag (7-day
    // window) — ONLY for human sends (invalid for bot/automation) and ONLY for
    // id-recipient DMs, never comment private replies (those carry their own
    // 7-day window and take no tag).
    if (!res.ok && input.humanAgent && !input.commentId) {
      const firstErr = parseMetaError(detail);
      if (
        describeMetaSendError("messenger", res.status, firstErr).category ===
        "outside_window"
      ) {
        res = await send(true);
        detail = res.ok ? "" : await res.text().catch(() => "");
      }
    }
    if (!res.ok) {
      const parsed = parseMetaError(detail);
      await handleMetaGraphError(supabaseAdmin(), input.connection, res.status, parsed);
      // Keep Meta's raw body in the server logs for debugging, but surface
      // only a clear, actionable Spanish message to the agent.
      console.error(`[messenger] send failed (${res.status}): ${detail}`);
      throw new Error(describeMetaSendError("messenger", res.status, parsed, await safeLocale()).userMessage);
    }
    // Send succeeded — auto-restore a connection previously flagged dead
    // so a recovered token re-greens without a manual reconnect.
    if (input.connection.status !== "connected") {
      await clearMetaConnectionError(supabaseAdmin(), input.connection);
    }
    const json = (await res.json()) as { message_id?: string };
    return { externalMessageId: json.message_id, status: "sent" };
  },

  async parseWebhook(
    ctx: ParsedWebhookContext,
    connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    const body = (ctx.payload ?? {}) as Record<string, unknown>;
    const events: InboundEvent[] = [];
    const entries = (body.entry as Array<Record<string, unknown>> | undefined) ?? [];
    // Our OWN page id — never ingest events where WE are the sender.
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    const selfIds = new Set([String(cfg.page_id ?? "")].filter(Boolean));
    // Decrypt the page token once and reuse it across senders in this
    // payload, so an inbox of bursty replies doesn't decrypt N times.
    let pageToken: string | null = null;
    const getToken = (): string | null => {
      if (pageToken !== null) return pageToken;
      const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
      const enc = String(secrets.access_token ?? "");
      pageToken = enc ? decrypt(enc) : "";
      return pageToken;
    };
    // Messenger webhooks don't carry the sender's name, and the lookups
    // (conversations API + /{psid}) are slow and often fail without Advanced
    // Access. So we DON'T block the message on them: ingest immediately with
    // no name (the inbox shows a generic label) and resolve names in the
    // BACKGROUND, updating the contact when they land. upsertContact backfills
    // names on update, so this is safe and the message appears instantly.
    const senderIds = new Set<string>();
    for (const entry of entries) {
      const messaging = (entry.messaging as Array<Record<string, unknown>> | undefined) ?? [];
      for (const m of messaging) {
        const sender = m.sender as { id?: string } | undefined;
        const message = m.message as
          | {
              mid?: string;
              text?: string;
              is_echo?: boolean;
              is_unsupported?: boolean;
              attachments?: Array<Record<string, unknown>>;
            }
          | undefined;
        if (!sender?.id) continue;
        const postback = m.postback as
          | { mid?: string; title?: string; payload?: string; referral?: unknown }
          | undefined;
        // Reacción a un mensaje: no es un mensaje nuevo, se guarda como estado
        // y la burbuja reaccionada muestra el emoji (igual que WhatsApp).
        if (m.reaction) {
          const recipient = m.recipient as { id?: string } | undefined;
          await handleMetaReaction({
            channel: "messenger",
            connection,
            senderId: String(sender.id),
            recipientId: recipient?.id ? String(recipient.id) : undefined,
            selfIds,
            reaction: m.reaction as MetaReactionEvent,
          });
          continue;
        }
        if (!message) {
          // Eventos SIN `message` que antes se descartaban enteros:
          //  - `postback`: la persona tocó un botón (el texto del botón es su
          //    respuesta y tiene que verse en el hilo como cualquier mensaje).
          //  - `referral`: llegó desde un anuncio a un chat que YA existía
          //    ("Este chat contiene una respuesta a …"). No es un mensaje:
          //    sólo sella el origen publicitario en la conversación.
          const pbTitle = String(postback?.title ?? "").trim();
          if (pbTitle) {
            senderIds.add(sender.id);
            events.push({
              channel: "messenger",
              connection,
              externalContactId: sender.id,
              externalMessageId:
                postback?.mid ?? `pb-${sender.id}-${String(m.timestamp ?? "")}`,
              text: pbTitle,
              receivedAt: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
              referral: mapMetaAdReferral(postback?.referral),
              raw: m,
            });
            continue;
          }
          const standalone =
            mapMetaAdReferral(m.referral) ?? mapMetaAdReferral(postback?.referral);
          if (standalone) {
            events.push({
              channel: "messenger",
              connection,
              externalContactId: sender.id,
              text: "",
              receivedAt: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
              referral: standalone,
              referralOnly: true,
              raw: m,
            });
          }
          continue;
        }
        // Echo: un mensaje que el negocio ENVIÓ — desde la app de Messenger, el
        // Business Suite o nuestra propia API (sender = page id). En vez de
        // descartarlo lo ingerimos SALIENTE, para que una respuesta escrita
        // desde el celular también se vea en Riverz (multicanal: se sincroniza
        // todo lo enviado y recibido). Lo enviado desde Riverz se deduplica por
        // message_id (mismo mid), así que no se duplica; sólo sobreviven los
        // mensajes escritos realmente desde el teléfono.
        const isEcho = Boolean(message.is_echo) || selfIds.has(String(sender.id));
        if (isEcho) {
          const recipient = m.recipient as { id?: string } | undefined;
          const customerId = recipient?.id ? String(recipient.id) : "";
          if (!customerId || selfIds.has(customerId)) continue;
          const echo = await ingestMetaAttachments({
            attachments: message.attachments,
            workspaceId: connection.workspace_id,
            externalContactId: customerId,
            externalMessageId: message.mid,
            accessToken: getToken() || undefined,
          });
          senderIds.add(customerId);
          events.push({
            channel: "messenger",
            connection,
            externalContactId: customerId,
            externalMessageId: message.mid,
            text: composeMetaText(
              message.text,
              echo.descriptions,
              echo.media.length > 0,
              Boolean(message.is_unsupported),
            ),
            attachments: echo.media.length ? echo.media : undefined,
            receivedAt: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
            outbound: true,
            raw: m,
          });
          continue;
        }
        senderIds.add(sender.id);
        // Messenger ships attachments con `type` (image/video/audio/file) y
        // `payload.url` ya público: lo persistimos en Storage para que la URL
        // no se nos expire. Lo que NO es archivo (enlace compartido, tarjeta
        // de producto, ubicación) vuelve como texto descriptivo, así el
        // mensaje se ve en la bandeja igual que en Messenger.
        const parsed = await ingestMetaAttachments({
          attachments: message.attachments,
          workspaceId: connection.workspace_id,
          externalContactId: sender.id,
          externalMessageId: message.mid,
          accessToken: getToken() || undefined,
        });
        // Click-to-Messenger ad context (the customer arrived from an ad). On
        // the messaging event as `referral` or nested under `postback.referral`.
        const referral =
          mapMetaAdReferral(m.referral) ?? mapMetaAdReferral(postback?.referral);
        events.push({
          channel: "messenger",
          connection,
          externalContactId: sender.id,
          externalMessageId: message.mid,
          text: composeMetaText(
            message.text,
            parsed.descriptions,
            parsed.media.length > 0,
            Boolean(message.is_unsupported),
          ),
          attachments: parsed.media.length ? parsed.media : undefined,
          receivedAt: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
          referral,
          raw: m,
        });
      }
    }
    // Fire-and-forget name resolution — never blocks the inbound insert.
    if (senderIds.size > 0) {
      void backfillMessengerNames(connection, [...senderIds], getToken());
    }
    return events;
  },

  async verifyWebhookHandshake(req: Request, connection: ChannelConnection): Promise<string | null> {
    return verifyMetaHandshake(req, connection);
  },
};

/**
 * Resolve a Messenger PSID to a display name via /{psid}?fields=name.
 * Returns undefined on any failure so the caller falls back to the
 * PSID — never block ingest on a profile fetch.
 */
async function fetchMessengerName(
  psid: string,
  token: string | null,
): Promise<string | undefined> {
  if (!token) return undefined;
  try {
    const r = await fetch(
      withAppsecretProof(
        `https://graph.facebook.com/v22.0/${psid}?fields=name&access_token=${encodeURIComponent(token)}`,
        token,
      ),
    );
    if (!r.ok) return undefined;
    const j = (await r.json()) as { name?: string };
    return j.name && j.name.trim() ? j.name.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve Messenger sender names AFTER ingest (so the message never waits on
 * Graph). Updates each contact's name only while it's still null. Fully
 * fire-and-forget — any error leaves the generic label for the next message
 * or the 6h backfill cron.
 */
async function backfillMessengerNames(
  connection: ChannelConnection,
  senderIds: string[],
  token: string | null,
): Promise<void> {
  try {
    const map = await buildParticipantMap(
      "messenger",
      connection,
      token ?? "",
      5,
    ).catch(() => new Map<string, string>());
    const db = supabaseAdmin();
    for (const id of senderIds) {
      const name = map.get(id) ?? (await fetchMessengerName(id, token));
      if (!name) continue;
      await db
        .from("contacts")
        .update({ name })
        .eq("workspace_id", connection.workspace_id)
        .eq("channel", "messenger")
        .eq("external_id", id)
        .is("name", null);
    }
  } catch (err) {
    console.error("[messenger] background name backfill failed:", err);
  }
}
