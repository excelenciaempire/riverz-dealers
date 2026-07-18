import type {
  ChannelAdapter,
  InboundEvent,
  OutboundText,
  ParsedWebhookContext,
  SendResult,
} from "../types";
import type { ChannelConnection } from "@/types";
import { decrypt, encrypt } from "../encryption";
import { supabaseAdmin } from "../admin-client";

/**
 * MercadoLibre — pre-sale QUESTIONS + post-sale MESSAGES in the unified inbox.
 *
 * Reply-only + resource-scoped (no free DM): the conversation's
 * thread_external_id encodes the target — `q:<question_id>` (answer a question)
 * or `pack:<pack_id>` (post-sale message pack) — so sendText picks the right ML
 * endpoint. Inbound arrives via app-level notifications (topic + resource path,
 * NO body) so parseWebhook must RE-FETCH the resource with a fresh seller token;
 * a poll cron reconciles anything a momentarily-dead token dropped.
 *
 * config:  { seller_id, site_id, token_expires_at }
 * secrets: { access_token, refresh_token }  (both encrypted; refresh rotates)
 */

const ML = "https://api.mercadolibre.com";

interface MlNotification {
  resource?: string; // e.g. "/questions/123" or "/messages/packs/456/sellers/789"
  user_id?: number | string;
  topic?: string; // questions | messages | orders_v2 | ...
  application_id?: number | string;
}

export const mercadoLibreAdapter: ChannelAdapter = {
  channel: "mercadolibre",
  label: "Mercado Libre",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.seller_id) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const token = await getFreshMLToken(input.connection);
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const sellerId = String(cfg.seller_id ?? "");

    // Target resource: prefer the reply-to (last inbound id), else the
    // conversation thread. Both are "q:<id>" or "pack:<id>".
    const target = input.replyToExternalId?.startsWith("q:")
      ? input.replyToExternalId
      : ((input.conversation as { thread_external_id?: string })?.thread_external_id ??
          input.replyToExternalId ??
          "");

    if (target.startsWith("q:")) {
      // Answer a pre-sale question (one-shot, max 2000 chars).
      const questionId = target.slice(2);
      const res = await fetch(`${ML}/answers`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ question_id: Number(questionId), text: input.text.slice(0, 2000) }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`[mercadolibre] answer failed (${res.status}): ${detail}`);
      }
      const json = (await res.json().catch(() => ({}))) as { id?: number };
      return { externalMessageId: json.id ? `a:${json.id}` : `q:${questionId}`, status: "sent" };
    }

    if (target.startsWith("pack:")) {
      // Post-sale message. Seller text is capped at 350 chars, ISO-8859-1
      // charset (drop chars outside latin1 so emojis don't 400 the send).
      const packId = target.slice(5);
      const buyerId = input.contact.external_id;
      if (!buyerId) throw new Error("[mercadolibre] pack reply missing buyer id");
      const text = [...input.text]
        .filter((c) => (c.codePointAt(0) ?? 0) <= 0xff)
        .join("")
        .slice(0, 350);
      const res = await fetch(
        `${ML}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: { user_id: sellerId },
            to: { user_id: buyerId },
            text,
          }),
        },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`[mercadolibre] message failed (${res.status}): ${detail}`);
      }
      const json = (await res.json().catch(() => ({}))) as { id?: string };
      return { externalMessageId: json.id ?? undefined, status: "sent" };
    }

    throw new Error("[mercadolibre] no resolvable target (question/pack) for this reply");
  },

  async parseWebhook(
    ctx: ParsedWebhookContext,
    connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    const n = ctx.payload as MlNotification | null;
    if (!n?.resource || !n.topic) return [];
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    const sellerId = String(cfg.seller_id ?? "");

    let token: string;
    try {
      token = await getFreshMLToken(connection);
    } catch (err) {
      console.error("[mercadolibre] token unavailable for webhook:", err);
      return [];
    }
    const auth = { authorization: `Bearer ${token}` };

    // ---- Questions ----
    if (n.topic === "questions" || n.topic === "marketplace_questions") {
      const r = await fetch(`${ML}${n.resource}?api_version=4`, { headers: auth });
      if (!r.ok) return [];
      const q = (await r.json()) as MlQuestion;
      // Only surface questions still awaiting an answer.
      if (!q.id || q.status !== "UNANSWERED" || !q.text) return [];
      const qBuyerId = String(q.from?.id ?? q.buyer_id ?? "ml");
      return [
        {
          channel: "mercadolibre",
          connection,
          externalContactId: qBuyerId,
          // ML no expone el nombre real (privacidad); usamos el apodo público.
          contactName: await resolveMlNickname(qBuyerId, auth),
          externalMessageId: `q:${q.id}`,
          externalThreadId: `q:${q.id}`,
          subject: q.item_id ? `Pregunta · ${q.item_id}` : undefined,
          text: q.text,
          receivedAt: q.date_created ?? new Date().toISOString(),
          raw: q,
        },
      ];
    }

    // ---- Post-sale messages ----
    if (n.topic === "messages" || n.topic === "marketplace_messages") {
      // The resource may be a pack path or a single message. Normalize to the
      // pack conversation and emit buyer-sent messages only.
      const packId = extractPackId(n.resource);
      if (!packId) return [];
      const r = await fetch(`${ML}/messages/packs/${packId}/sellers/${sellerId}?mark_as_read=false`, {
        headers: auth,
      });
      if (!r.ok) return [];
      const conv = (await r.json()) as MlPack;
      const events: InboundEvent[] = [];
      const nickCache = new Map<string, string | undefined>();
      for (const m of conv.messages ?? []) {
        const fromId = String(m.from?.user_id ?? "");
        // Skip our own (seller) messages — those are echoes of what we sent.
        if (!m.id || !fromId || fromId === sellerId) continue;
        if (!nickCache.has(fromId)) {
          nickCache.set(fromId, await resolveMlNickname(fromId, auth));
        }
        events.push({
          channel: "mercadolibre",
          connection,
          externalContactId: fromId,
          contactName: nickCache.get(fromId),
          externalMessageId: m.id,
          externalThreadId: `pack:${packId}`,
          text: m.text ?? "",
          receivedAt: m.message_date?.created ?? new Date().toISOString(),
          raw: m,
        });
      }
      return events;
    }

    // orders_v2 / others: ignored here (the poll discovers packs).
    return [];
  },
};

// ── Token refresh (rotating refresh_token — must persist the new one) ──
export async function getFreshMLToken(connection: ChannelConnection): Promise<string> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const expiresAt = config.token_expires_at ? Date.parse(String(config.token_expires_at)) : 0;
  const accessEnc = String(secrets.access_token ?? "");
  if (accessEnc && expiresAt > Date.now() + 120_000) return decrypt(accessEnc);

  const refreshEnc = String(secrets.refresh_token ?? "");
  if (!refreshEnc) throw new Error("[mercadolibre] connection missing refresh_token");
  const res = await fetch(`${ML}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.MERCADOLIBRE_CLIENT_ID ?? "",
      client_secret: process.env.MERCADOLIBRE_CLIENT_SECRET ?? "",
      refresh_token: decrypt(refreshEnc),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    await supabaseAdmin()
      .from("channel_connections")
      .update({ status: "error", last_error: `ML token refresh failed: ${detail.slice(0, 300)}` })
      .eq("id", connection.id);
    throw new Error(`[mercadolibre] token refresh failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error("[mercadolibre] refresh returned no access_token");
  const newExpiry = new Date(Date.now() + (json.expires_in ?? 21_600) * 1000).toISOString();
  await supabaseAdmin()
    .from("channel_connections")
    .update({
      secrets: {
        ...secrets,
        access_token: encrypt(json.access_token),
        // Single-use refresh token — persist the rotated one or the connection dies.
        ...(json.refresh_token ? { refresh_token: encrypt(json.refresh_token) } : {}),
      },
      config: { ...config, token_expires_at: newExpiry },
      status: "connected",
      last_error: null,
    })
    .eq("id", connection.id);
  return json.access_token;
}

/**
 * Resolve a MercadoLibre user's PUBLIC nickname (ML never exposes the real
 * name). Best-effort: returns undefined on any failure so ingest still works
 * and the UI falls back to "Cliente Mercado Libre · …id".
 */
async function resolveMlNickname(
  userId: string,
  auth: Record<string, string>,
): Promise<string | undefined> {
  if (!userId || userId === "ml") return undefined;
  try {
    const r = await fetch(`${ML}/users/${userId}`, { headers: auth });
    if (!r.ok) return undefined;
    const u = (await r.json()) as { nickname?: string };
    return u.nickname || undefined;
  } catch {
    return undefined;
  }
}

/** Pull the pack id from a resource path like "/messages/packs/123/sellers/456". */
function extractPackId(resource: string): string | null {
  const m = resource.match(/\/messages\/packs\/([^/]+)/);
  return m ? m[1] : null;
}

interface MlQuestion {
  id?: number;
  seller_id?: number;
  buyer_id?: number;
  item_id?: string;
  text?: string;
  status?: string;
  date_created?: string;
  from?: { id?: number };
}
interface MlPack {
  messages?: Array<{
    id?: string;
    text?: string;
    from?: { user_id?: number | string };
    to?: { user_id?: number | string };
    message_date?: { created?: string };
  }>;
}
