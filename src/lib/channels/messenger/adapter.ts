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

    if (!input.contact.external_id) {
      throw new Error("[messenger] contact missing external_id (page-scoped PSID)");
    }

    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipient: { id: input.contact.external_id },
        messaging_type: "RESPONSE",
        message: { text: input.text },
        access_token: accessToken,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`[messenger] send failed (${res.status}): ${detail}`);
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
    for (const entry of entries) {
      const messaging = (entry.messaging as Array<Record<string, unknown>> | undefined) ?? [];
      for (const m of messaging) {
        const sender = m.sender as { id?: string } | undefined;
        const message = m.message as { mid?: string; text?: string } | undefined;
        if (!sender?.id || !message) continue;
        // Messenger webhooks don't carry the sender's name — resolve it
        // from /{psid}?fields=name so the inbox shows "Juan Pérez"
        // instead of a 16-digit PSID. Best-effort: any error keeps the
        // event flowing (the PSID stays as the fallback display).
        const name = await fetchMessengerName(sender.id, getToken());
        events.push({
          channel: "messenger",
          connection,
          externalContactId: sender.id,
          contactName: name,
          externalMessageId: message.mid,
          text: String(message.text ?? ""),
          receivedAt: new Date(Number(m.timestamp ?? Date.now())).toISOString(),
          raw: m,
        });
      }
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
      `https://graph.facebook.com/v22.0/${psid}?fields=name&access_token=${encodeURIComponent(token)}`,
    );
    if (!r.ok) return undefined;
    const j = (await r.json()) as { name?: string };
    return j.name && j.name.trim() ? j.name.trim() : undefined;
  } catch {
    return undefined;
  }
}
