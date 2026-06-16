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
import {
  handleMetaGraphError,
  parseMetaErrorBody,
  clearMetaConnectionError,
} from "../meta-auth";
import { supabaseAdmin } from "../admin-client";

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
      await handleMetaGraphError(
        supabaseAdmin(),
        input.connection,
        res.status,
        parseMetaErrorBody(detail),
      );
      throw new Error(`[messenger] send failed (${res.status}): ${detail}`);
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
        const message = m.message as
          | {
              mid?: string;
              text?: string;
              attachments?: Array<Record<string, unknown>>;
            }
          | undefined;
        if (!sender?.id || !message) continue;
        // Messenger webhooks don't carry the sender's name — resolve it
        // from /{psid}?fields=name so the inbox shows "Juan Pérez"
        // instead of a 16-digit PSID. Best-effort: any error keeps the
        // event flowing (the PSID stays as the fallback display).
        const name = await fetchMessengerName(sender.id, getToken());
        // Messenger ships attachments con `type` (image/video/audio/file)
        // y `payload.url` ya público. Lo persistimos en Storage para
        // que la URL no se nos expire después.
        const attachments = await ingestMessengerAttachments(
          message.attachments ?? [],
          connection.workspace_id,
          sender.id,
          message.mid,
        );
        events.push({
          channel: "messenger",
          connection,
          externalContactId: sender.id,
          contactName: name,
          externalMessageId: message.mid,
          text: String(message.text ?? ""),
          attachments: attachments.length ? attachments : undefined,
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
 * Procesa el array `message.attachments` que ship Messenger en sus
 * webhooks. Cada item trae `type` (image/video/audio/file/location)
 * y `payload.url` con la URL pública. Bajamos cada uno y lo subimos
 * a Storage para tener un permalink propio.
 *
 * Ignora silenciosamente locations / templates / fallbacks — no son
 * media bajable. Best-effort: si una descarga falla la salteamos y
 * seguimos con el resto.
 */
async function ingestMessengerAttachments(
  attachments: Array<Record<string, unknown>>,
  workspaceId: string,
  externalContactId: string,
  externalMessageId?: string,
): Promise<MessageAttachment[]> {
  const out: MessageAttachment[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    const type = String(a.type ?? "").toLowerCase();
    const payload = (a.payload ?? {}) as { url?: string };
    const url = payload.url ? String(payload.url) : "";
    if (!url) continue;
    if (type === "location" || type === "template" || type === "fallback") {
      continue;
    }
    const hintedKind =
      type === "image"
        ? "image"
        : type === "video"
          ? "video"
          : type === "audio"
            ? "audio"
            : type === "file"
              ? "document"
              : undefined;
    const ingested = await ingestMetaAttachment({
      attachmentUrl: url,
      workspaceId,
      // Path estable por sender — la conversation row se crea
      // después en inbox-writer.
      conversationId: externalContactId,
      externalMessageId: externalMessageId
        ? `${externalMessageId}-${i}`
        : undefined,
      hintedKind,
    });
    if (!ingested) continue;
    out.push({
      url: ingested.publicUrl,
      mime_type: ingested.mediaMime,
      size: ingested.mediaSize,
    });
  }
  return out;
}

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
