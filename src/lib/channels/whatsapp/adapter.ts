import type { ChannelAdapter, InboundEvent, OutboundText, OutboundTemplate, SendResult } from "../types";
import type { ChannelConnection } from "@/types";
import { decrypt } from "../encryption";

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

    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
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
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[whatsapp] send failed (${res.status}): ${detail}`);
    }
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

    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
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
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[whatsapp] template send failed (${res.status}): ${detail}`);
    }
    const json = (await res.json()) as { messages?: { id?: string }[] };
    return { externalMessageId: json.messages?.[0]?.id, status: "sent" };
  },

  async parseWebhook(req: Request, connection: ChannelConnection): Promise<InboundEvent[]> {
    const body = (await req.json().catch(() => null)) as WhatsAppWebhookBody | null;
    if (!body || body.object !== "whatsapp_business_account") return [];

    const events: InboundEvent[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value;
        if (!value?.messages) continue;

        // Map wa_id → profile name from the contacts array.
        const nameByWaId = new Map<string, string>();
        for (const c of value.contacts ?? []) {
          if (c.wa_id) nameByWaId.set(c.wa_id, c.profile?.name ?? "");
        }

        for (const m of value.messages) {
          if (!m.from || !m.id) continue;
          const text = extractText(m);
          events.push({
            channel: "whatsapp",
            connection,
            externalContactId: m.from,
            contactName: nameByWaId.get(m.from) || undefined,
            externalMessageId: m.id,
            text,
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
      };
    }[];
  }[];
}

interface WhatsAppMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  video?: { id: string; caption?: string };
  document?: { id: string; filename?: string; caption?: string };
  audio?: { id: string };
  location?: { name?: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}
