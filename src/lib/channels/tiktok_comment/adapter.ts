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
 * TikTok — comments on the merchant's OWN videos (Business Account /
 * Accounts API, scope "TikTok Accounts") in the unified inbox.
 *
 * Reply-only surface (TikTok has no open DM API for third parties — DMs are
 * gated behind the Messaging Partner program): the merchant reads and answers
 * the comments customers leave on their videos. Inbound arrives via the
 * polling cron (`tiktok_comment/poll.ts`); replies go out through
 * /business/comment/reply/create/.
 *
 * Auth (Accounts API): the account holder authorizes via the portal-generated
 * authorization URL; tokens come from /tt_user/oauth2/token/. The ACCESS token
 * lives 24h and the REFRESH token 1 year, so every API call goes through
 * getFreshTikTokToken() which renews on-demand and persists rotated tokens.
 *
 * config:  { business_id, username, display_name, token_expires_at }
 * secrets: { access_token, refresh_token }  (encrypted)
 *
 * NOTE: endpoint field names follow the official Business API v1.3 docs; the
 * integration can only be exercised end-to-end once TikTok approves the app
 * (status Pending), so keep responses parsed defensively.
 */

const TT = "https://business-api.tiktok.com/open_api/v1.3";

export const tikTokCommentAdapter: ChannelAdapter = {
  channel: "tiktok_comment",
  label: "TikTok",

  isConfigured(connection: ChannelConnection): boolean {
    const cfg = (connection.config ?? {}) as Record<string, unknown>;
    return Boolean(cfg.business_id) && Boolean(connection.secrets);
  },

  async sendText(input: OutboundText): Promise<SendResult> {
    const token = await getFreshTikTokToken(input.connection);
    const cfg = (input.connection.config ?? {}) as Record<string, unknown>;
    const businessId = String(cfg.business_id ?? "");

    // Reply target: the comment id (preferred) + its video. The conversation
    // thread is "video:<id>|comment:<id>" (see poll.ts) so a plain inbox reply
    // still resolves both.
    const thread = String(
      (input.conversation as { thread_external_id?: string })?.thread_external_id ?? "",
    );
    const commentId = input.replyToExternalId ?? thread.split("|comment:")[1] ?? "";
    const videoId = thread.startsWith("video:") ? thread.slice(6).split("|")[0] : "";
    if (!businessId || !commentId) {
      throw new Error("[tiktok] reply target missing (business_id/comment_id)");
    }

    const res = await fetch(`${TT}/business/comment/reply/create/`, {
      method: "POST",
      headers: { "Access-Token": token, "content-type": "application/json" },
      body: JSON.stringify({
        business_id: businessId,
        video_id: videoId || undefined,
        comment_id: commentId,
        text: input.text.slice(0, 150), // TikTok comments cap at 150 chars
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: { comment_id?: string };
    };
    if (!res.ok || (json.code ?? 0) !== 0) {
      throw new Error(`[tiktok] reply failed (${res.status}): ${json.message ?? ""}`);
    }
    return { externalMessageId: json.data?.comment_id, status: "sent" };
  },

  async parseWebhook(
    _ctx: ParsedWebhookContext,
    _connection: ChannelConnection,
  ): Promise<InboundEvent[]> {
    // Accounts API webhooks require per-app callback configuration in the
    // TikTok portal (available post-approval). Until that is armed, ingestion
    // is handled by the polling cron; deliveries here are acked and dropped.
    return [];
  },
};

/** Fresh access token — renews via the 1-year refresh token when the 24h
 *  access token is (nearly) expired, persisting rotated credentials. */
export async function getFreshTikTokToken(connection: ChannelConnection): Promise<string> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const expiresAt = config.token_expires_at ? Date.parse(String(config.token_expires_at)) : 0;
  const accessEnc = String(secrets.access_token ?? "");
  if (accessEnc && expiresAt > Date.now() + 300_000) return decrypt(accessEnc);

  const refreshEnc = String(secrets.refresh_token ?? "");
  if (!refreshEnc) throw new Error("[tiktok] connection missing refresh_token");
  const res = await fetch(`${TT}/tt_user/oauth2/refresh_token/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.TIKTOK_APP_ID ?? "",
      client_secret: process.env.TIKTOK_APP_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: decrypt(refreshEnc),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
    data?: { access_token?: string; refresh_token?: string; expires_in?: number };
  };
  if (!res.ok || (json.code ?? 0) !== 0 || !json.data?.access_token) {
    const detail = json.message ?? String(res.status);
    await supabaseAdmin()
      .from("channel_connections")
      .update({ status: "error", last_error: `TikTok token refresh failed: ${detail.slice(0, 300)}` })
      .eq("id", connection.id);
    throw new Error(`[tiktok] token refresh failed: ${detail}`);
  }
  const newExpiry = new Date(Date.now() + (json.data.expires_in ?? 86_400) * 1000).toISOString();
  await supabaseAdmin()
    .from("channel_connections")
    .update({
      secrets: {
        ...secrets,
        access_token: encrypt(json.data.access_token),
        ...(json.data.refresh_token ? { refresh_token: encrypt(json.data.refresh_token) } : {}),
      },
      config: { ...config, token_expires_at: newExpiry },
      status: "connected",
      last_error: null,
    })
    .eq("id", connection.id);
  return json.data.access_token;
}
