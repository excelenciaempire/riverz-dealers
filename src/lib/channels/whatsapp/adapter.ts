import type { ChannelAdapter, InboundEvent, OutboundText, OutboundTemplate, SendResult } from "../types";
import type { ChannelConnection } from "@/types";

/**
 * WhatsApp (Meta Cloud API + Coexistence mode).
 *
 * Implementation note: legacy code in `lib/whatsapp/*` and the
 * `/api/whatsapp/*` route handlers still owns the day-to-day send /
 * webhook plumbing. This adapter is the new entry point — Phase 5
 * fully ports those routes to delegate through here so the channels
 * registry becomes the single source of truth.
 */
export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  label: "WhatsApp Business",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.phone_number_id) && Boolean(connection.secrets);
  },

  async sendText(_input: OutboundText): Promise<SendResult> {
    throw new Error(
      "[whatsapp] sendText via unified router not yet wired. " +
        "Use /api/whatsapp/send until Phase 5 lands.",
    );
  },

  async sendTemplate(_input: OutboundTemplate): Promise<SendResult> {
    throw new Error(
      "[whatsapp] sendTemplate via unified router not yet wired. " +
        "Use /api/whatsapp/send until Phase 5 lands.",
    );
  },

  async parseWebhook(_req: Request, _connection: ChannelConnection): Promise<InboundEvent[]> {
    throw new Error(
      "[whatsapp] parseWebhook via unified router not yet wired. " +
        "Use /api/whatsapp/webhook until Phase 5 lands.",
    );
  },

  async verifyWebhookHandshake(req: Request, connection: ChannelConnection): Promise<string | null> {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === connection.webhook_secret) {
      return challenge;
    }
    return null;
  },
};
