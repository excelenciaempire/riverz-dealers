import type {
  ChannelAdapter,
  InboundEvent,
  OutboundText,
  OutboundTemplate,
  ParsedWebhookContext,
  SendResult,
} from "../types";
import type { ChannelConnection, MessageAttachment } from "@/types";
import { decrypt } from "../encryption";
import { ingestWhatsappMedia, type MediaCategory } from "../media-ingest";
import {
  handleMetaGraphError,
  parseMetaErrorBody,
  clearMetaConnectionError,
} from "../meta-auth";
import { withAppsecretProof } from "../meta-graph";
import { supabaseAdmin } from "../admin-client";

/** After a successful Meta call, restore a connection that was
 *  previously flagged dead (status='error'/'expired') so a recovered
 *  token re-greens without a manual reconnect. Guarded on the loaded
 *  status so healthy sends don't issue a needless UPDATE. */
async function healIfRecovered(connection: ChannelConnection): Promise<void> {
  if (connection.status !== "connected") {
    await clearMetaConnectionError(supabaseAdmin(), connection);
  }
}

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * WhatsApp (Meta Cloud API).
 *
 * Fully wired through the unified channels router: inbound via
 * /api/channels/whatsapp/webhook, outbound via /api/messages/send.
 * The connection carries `config.phone_number_id` and an encrypted
 * `secrets.access_token` (a permanent system/long-lived user token).
 */
export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  label: "WhatsApp Business",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.phone_number_id) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const phoneNumberId = String(cfg.phone_number_id ?? "");
    if (!phoneNumberId) throw new Error("[whatsapp] connection missing phone_number_id");

    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[whatsapp] connection missing access_token");
    const accessToken = decrypt(encrypted);

    const to = input.contact.phone || input.contact.external_id;
    if (!to) throw new Error("[whatsapp] contact missing phone/wa_id");

    const res = await fetch(
      withAppsecretProof(`${GRAPH}/${phoneNumberId}/messages`, accessToken),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: input.text },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // On 401 / OAuthException / code 190 / 102 / 463, flip the
      // connection to status='error' with last_error so the Settings
      // → Canales card shows a "Reconectar" CTA instead of a green
      // dot over a broken token.
      await handleMetaGraphError(
        supabaseAdmin(),
        input.connection,
        res.status,
        parseMetaErrorBody(detail),
      );
      throw new Error(`[whatsapp] send failed (${res.status}): ${detail}`);
    }
    await healIfRecovered(input.connection);
    const json = (await res.json()) as { messages?: { id?: string }[] };
    return { externalMessageId: json.messages?.[0]?.id, status: "sent" };
  },

  async sendTemplate(input: OutboundTemplate): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const phoneNumberId = String(cfg.phone_number_id ?? "");
    if (!phoneNumberId) throw new Error("[whatsapp] connection missing phone_number_id");

    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[whatsapp] connection missing access_token");
    const accessToken = decrypt(encrypted);

    const to = input.contact.phone || input.contact.external_id;
    if (!to) throw new Error("[whatsapp] contact missing phone/wa_id");

    const res = await fetch(
      withAppsecretProof(`${GRAPH}/${phoneNumberId}/messages`, accessToken),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: input.templateName,
            language: { code: input.language ?? "es" },
            components: input.params?.length
              ? [
                  {
                    type: "body",
                    parameters: input.params.map((text) => ({ type: "text", text })),
                  },
                ]
              : undefined,
          },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await handleMetaGraphError(
        supabaseAdmin(),
        input.connection,
        res.status,
        parseMetaErrorBody(detail),
      );
      throw new Error(`[whatsapp] template send failed (${res.status}): ${detail}`);
    }
    await healIfRecovered(input.connection);
    const json = (await res.json()) as { messages?: { id?: string }[] };
    return { externalMessageId: json.messages?.[0]?.id, status: "sent" };
  },

  async parseWebhook(
    ctx: ParsedWebhookContext,
    connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    const body = ctx.payload as WhatsAppWebhookBody | null;
    if (!body || body.object !== "whatsapp_business_account") return [];

    const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
    const encryptedToken = String(secrets.access_token ?? "");

    const events: InboundEvent[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        // --- Coexistence: echoes of messages the merchant sent from their own
        //     phone's WhatsApp Business app. Stored OUTBOUND (agent) so the AI
        //     never double-replies to a customer the human already answered. ---
        if (change.field === "smb_message_echoes" && value.message_echoes) {
          for (const e of value.message_echoes) {
            if (!e.to || !e.id || e.type === "revoke" || e.type === "edit") continue;
            const att = await ingestInboundMedia({
              message: e,
              encryptedToken,
              workspaceId: connection.workspace_id,
              externalContactId: e.to,
            });
            events.push({
              channel: "whatsapp",
              connection,
              externalContactId: e.to,
              externalMessageId: e.id,
              text: extractText(e),
              attachments: att.length ? att : undefined,
              receivedAt: e.timestamp
                ? new Date(Number(e.timestamp) * 1000).toISOString()
                : new Date().toISOString(),
              outbound: true,
              raw: e,
            });
          }
          continue;
        }

        // --- Coexistence: past chats synced from the app. Direction derived
        //     from `from` vs the business number; flagged historical so old
        //     messages never trigger the AI. ---
        if (change.field === "history" && value.history) {
          const bizPhone = onlyDigits(
            value.metadata?.display_phone_number ??
              String(
                (connection.config as Record<string, unknown>)
                  ?.display_phone_number ?? "",
              ),
          );
          for (const chunk of value.history) {
            for (const thread of chunk.threads ?? []) {
              if (!thread.id) continue;
              for (const m of thread.messages ?? []) {
                if (!m.id || m.type === "revoke" || m.type === "edit") continue;
                const fromBusiness =
                  bizPhone.length >= 8 &&
                  onlyDigits(m.from ?? "").endsWith(bizPhone.slice(-10));
                const att = await ingestInboundMedia({
                  message: m,
                  encryptedToken,
                  workspaceId: connection.workspace_id,
                  externalContactId: thread.id,
                });
                events.push({
                  channel: "whatsapp",
                  connection,
                  externalContactId: thread.id,
                  externalMessageId: m.id,
                  text: extractText(m),
                  attachments: att.length ? att : undefined,
                  receivedAt: m.timestamp
                    ? new Date(Number(m.timestamp) * 1000).toISOString()
                    : new Date().toISOString(),
                  outbound: fromBusiness,
                  historical: true,
                  raw: m,
                });
              }
            }
          }
          continue;
        }

        // --- Coexistence: the merchant's contacts synced from the app. ---
        if (change.field === "smb_app_state_sync" && value.state_sync) {
          await upsertCoexistenceContacts(connection.workspace_id, value.state_sync);
          continue;
        }

        if (change.field !== "messages" || !value.messages) continue;

        // Map wa_id → profile name from the contacts array.
        const nameByWaId = new Map<string, string>();
        for (const c of value.contacts ?? []) {
          if (c.wa_id) nameByWaId.set(c.wa_id, c.profile?.name ?? "");
        }

        for (const m of value.messages) {
          if (!m.from || !m.id) continue;
          const text = extractText(m);
          // Si el mensaje trae media, bajamos los bytes ahora y los
          // subimos a Supabase Storage para tener una URL pública
          // estable. Si la descarga falla, dejamos el texto "[Imagen]"
          // y seguimos — nunca bloqueamos el ingest por un media roto.
          const attachments = await ingestInboundMedia({
            message: m,
            encryptedToken,
            workspaceId: connection.workspace_id,
            externalContactId: m.from,
          });
          const referral = m.referral
            ? {
                sourceType: m.referral.source_type,
                sourceId: m.referral.source_id,
                ctwaClid: m.referral.ctwa_clid,
                sourceUrl: m.referral.source_url,
                headline: m.referral.headline,
                body: m.referral.body,
                mediaType: m.referral.media_type,
              }
            : undefined;
          events.push({
            channel: "whatsapp",
            connection,
            externalContactId: m.from,
            contactName: nameByWaId.get(m.from) || undefined,
            externalMessageId: m.id,
            text,
            referral,
            attachments: attachments.length ? attachments : undefined,
            // WhatsApp timestamps are Unix SECONDS as a string.
            receivedAt: m.timestamp
              ? new Date(Number(m.timestamp) * 1000).toISOString()
              : new Date().toISOString(),
            raw: m,
          });
        }
      }
    }
    return events;
  },

  async verifyWebhookHandshake(req: Request, connection: ChannelConnection): Promise<string | null> {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    // Accept either the per-connection secret or the shared Meta verify
    // token (the unified route already handles the shared-token case
    // before reaching here, but keep both paths working).
    const expected = connection.webhook_secret || process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === "subscribe" && token && expected && token === expected) {
      return challenge;
    }
    return null;
  },
};

/** Strip everything but digits — for comparing phone numbers across formats. */
function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

/**
 * Coexistence `smb_app_state_sync`: upsert the merchant's phone contacts so the
 * inbox shows real names. Keyed by external_id = the raw wa_id/phone (matching
 * how inbound messages key contacts). `remove` is ignored — never delete a
 * contact that may already have conversation history. Best-effort per item.
 */
async function upsertCoexistenceContacts(
  workspaceId: string,
  stateSync: Array<{
    type?: string;
    action?: string;
    contact?: { full_name?: string; first_name?: string; phone_number?: string };
  }>,
): Promise<void> {
  const db = supabaseAdmin();
  for (const item of stateSync ?? []) {
    if (item?.type !== "contact" || !item.contact || item.action === "remove") continue;
    const external = onlyDigits(item.contact.phone_number ?? "");
    if (!external) continue;
    const name = item.contact.full_name || item.contact.first_name || "";
    try {
      const { data: existing } = await db
        .from("contacts")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .eq("channel", "whatsapp")
        .eq("external_id", external)
        .maybeSingle();
      if (existing) {
        if (name && (existing as { name?: string }).name !== name) {
          await db.from("contacts").update({ name }).eq("id", (existing as { id: string }).id);
        }
      } else {
        await db.from("contacts").insert({
          workspace_id: workspaceId,
          channel: "whatsapp",
          external_id: external,
          phone: external,
          name: name || external,
        });
      }
    } catch (err) {
      console.warn("[whatsapp] coexistence contact upsert failed:", err);
    }
  }
}

function extractText(m: WhatsAppMessage): string {
  switch (m.type) {
    case "text":
      return m.text?.body ?? "";
    case "image":
      return m.image?.caption ?? "[Imagen]";
    case "video":
      return m.video?.caption ?? "[Video]";
    case "document":
      return m.document?.caption ?? m.document?.filename ?? "[Documento]";
    case "audio":
      return "[Audio]";
    case "sticker":
      return "[Sticker]";
    case "location":
      return m.location?.name ?? "[Ubicación]";
    case "interactive":
      return (
        m.interactive?.button_reply?.title ??
        m.interactive?.list_reply?.title ??
        "[Respuesta interactiva]"
      );
    default:
      return m.text?.body ?? `[${m.type}]`;
  }
}

interface WhatsAppWebhookBody {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: WhatsAppMessage[];
        // Coexistence-only fields (merchant kept the WhatsApp Business app).
        message_echoes?: WhatsAppMessage[];
        history?: { threads?: { id?: string; messages?: WhatsAppMessage[] }[] }[];
        state_sync?: {
          type?: string;
          action?: string;
          contact?: { full_name?: string; first_name?: string; phone_number?: string };
        }[];
      };
    }[];
  }[];
}

interface WhatsAppMessage {
  id?: string;
  from?: string;
  /** Recipient (the customer) — present on echoes / history messages. */
  to?: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type?: string };
  video?: { id: string; caption?: string; mime_type?: string };
  document?: {
    id: string;
    filename?: string;
    caption?: string;
    mime_type?: string;
  };
  audio?: { id: string; voice?: boolean; mime_type?: string };
  sticker?: { id: string; mime_type?: string; animated?: boolean };
  location?: { name?: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  /** Present when the message came from a Click-to-WhatsApp ad. */
  referral?: {
    source_type?: string;
    source_id?: string;
    ctwa_clid?: string;
    source_url?: string;
    headline?: string;
    body?: string;
    media_type?: string;
  };
}

/**
 * Para mensajes con media, baja el archivo desde Meta y lo sube a
 * Storage. Devuelve un array de MessageAttachment listos para
 * persistir en `messages.attachments`. Si la descarga falla devuelve
 * []. Soporta image/video/document/audio/voice/sticker — WhatsApp
 * sólo manda UNA pieza por mensaje, pero usamos array para que sea
 * consistente con IG/Messenger y futuras extensiones.
 */
async function ingestInboundMedia(args: {
  message: WhatsAppMessage;
  encryptedToken: string;
  workspaceId: string;
  externalContactId: string;
}): Promise<MessageAttachment[]> {
  const { message: m, encryptedToken, workspaceId, externalContactId } = args;
  if (!encryptedToken) return [];

  let mediaId: string | undefined;
  let hintedKind: MediaCategory | undefined;
  let fileName: string | undefined;
  switch (m.type) {
    case "image":
      mediaId = m.image?.id;
      hintedKind = "image";
      break;
    case "video":
      mediaId = m.video?.id;
      hintedKind = "video";
      break;
    case "document":
      mediaId = m.document?.id;
      hintedKind = "document";
      fileName = m.document?.filename;
      break;
    case "audio":
      mediaId = m.audio?.id;
      // WhatsApp distingue voice notes con `voice: true`. El resto
      // (audio adjunto) lo marcamos como "audio".
      hintedKind = m.audio?.voice ? "voice" : "audio";
      break;
    case "sticker":
      mediaId = m.sticker?.id;
      hintedKind = "sticker";
      break;
    default:
      return [];
  }
  if (!mediaId) return [];

  const ingested = await ingestWhatsappMedia({
    mediaId,
    encryptedAccessToken: encryptedToken,
    workspaceId,
    // Usamos el wa_id del cliente como segmento de path porque acá
    // todavía no creamos la conversation row. Es estable y único
    // por sender — el inbox-writer no toca esto.
    conversationId: externalContactId,
    hintedKind,
    fileName,
  });
  if (!ingested) return [];

  const attachment: MessageAttachment = {
    url: ingested.publicUrl,
    mime_type: ingested.mediaMime,
    name: fileName,
    size: ingested.mediaSize,
  };
  return [attachment];
}
