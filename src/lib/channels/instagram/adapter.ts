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
 * Instagram DMs via Meta Graph API (Messenger Platform for IG).
 *
 * Required config (channel_connections.config):
 *   - ig_user_id   — Instagram Professional account user id
 *   - page_id      — Connected Facebook page id (required by IG Messaging)
 *
 * Required secret (channel_connections.secrets):
 *   - access_token — Page access token with instagram_manage_messages
 *
 * Webhook subscription: IG `messages` field on the connected page.
 */
export const instagramAdapter: ChannelAdapter = {
  channel: "instagram",
  label: "Instagram DMs",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.ig_user_id) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const pageId = String(cfg.page_id ?? "");
    if (!pageId) throw new Error("[instagram] connection missing page_id");

    const secrets = (input.connection.secrets ?? {}) as Record<string, unknown>;
    const encrypted = String(secrets.access_token ?? "");
    if (!encrypted) throw new Error("[instagram] connection missing access_token");
    const accessToken = decrypt(encrypted);

    if (!input.contact.external_id) {
      throw new Error("[instagram] contact missing external_id (IG-scoped sender id)");
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
      throw new Error(`[instagram] send failed (${res.status}): ${detail}`);
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
        const message = m.message as
          | { mid?: string; text?: string; attachments?: Array<Record<string, unknown>> }
          | undefined;
        if (!sender?.id || !message) continue;
        // IG webhooks ship the IGSID but no display label — resolve to
        // @username from /{igsid}?fields=username,name so the inbox row
        // reads as "@somehandle" instead of a 17-digit id.
        const name = await fetchInstagramName(sender.id, getToken());
        events.push({
          channel: "instagram",
          connection,
          externalContactId: sender.id,
          contactName: name,
          externalMessageId: message.mid,
          text: String(message.text ?? ""),
          attachments: (message.attachments ?? [])
            .filter((a) => typeof a === "object")
            .map((a) => ({
              url: String((a.payload as { url?: string } | undefined)?.url ?? ""),
              mime_type: String(a.type ?? "image"),
            }))
            .filter((a) => a.url),
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
 * Resolve an IGSID to a display label, preferring "@username" over the
 * full name (matches how IG shows people everywhere). Best-effort —
 * undefined on any failure so ingest never blocks on a profile fetch.
 */
async function fetchInstagramName(
  igsid: string,
  token: string | null,
): Promise<string | undefined> {
  if (!token) return undefined;
  try {
    const r = await fetch(
      `https://graph.facebook.com/v22.0/${igsid}?fields=username,name&access_token=${encodeURIComponent(token)}`,
    );
    if (!r.ok) return undefined;
    const j = (await r.json()) as { username?: string; name?: string };
    if (j.username && j.username.trim()) return `@${j.username.trim()}`;
    if (j.name && j.name.trim()) return j.name.trim();
    return undefined;
  } catch {
    return undefined;
  }
}
