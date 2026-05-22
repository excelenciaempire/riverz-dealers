/**
 * Meta Graph API helpers: page discovery, IG account resolution,
 * page-access-token exchange, and webhook subscription. Called by the
 * OAuth callback after a Meta connection completes so an admin doesn't
 * have to wire webhooks manually in developers.facebook.com.
 */

import type { Channel } from "@/types";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  /** True if this page has an Instagram Professional account attached. */
  instagram_business_account_id?: string;
}

export interface DiscoveredAccount {
  /** Which connection-channel row this account should map to. */
  channel: Channel;
  /** External id stored on the connection: page_id, ig_user_id,
   *  phone_number_id depending on channel. */
  external_account_id: string;
  /** Page-scoped access token (not the user token). */
  page_access_token: string;
  /** Extra config persisted on the connection. */
  config: Record<string, unknown>;
  /** Display label. */
  label: string;
}

/**
 * Lists pages the connected user manages, including the IG Professional
 * account id attached to each (if any).
 */
export async function listUserPages(userAccessToken: string): Promise<MetaPage[]> {
  const url = `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id}&access_token=${encodeURIComponent(userAccessToken)}`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`[meta] /me/accounts failed (${r.status}): ${await r.text()}`);
  }
  const j = (await r.json()) as {
    data?: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id: string };
    }>;
  };
  return (j.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    access_token: p.access_token,
    instagram_business_account_id: p.instagram_business_account?.id,
  }));
}

/**
 * Resolves the list of "things to connect" for a Meta OAuth callback,
 * based on the requested channel:
 *
 *   - messenger / fb_comment → one entry per FB page
 *   - instagram / ig_comment → one entry per page that has an IG
 *     Professional account attached
 *   - whatsapp               → whatsapp_business_account → phone numbers
 */
export async function discoverMetaAccounts(
  userAccessToken: string,
  channel: Channel,
): Promise<DiscoveredAccount[]> {
  if (channel === "whatsapp") {
    return discoverWhatsAppAccounts(userAccessToken);
  }
  const pages = await listUserPages(userAccessToken);
  if (channel === "messenger" || channel === "fb_comment") {
    return pages.map((p) => ({
      channel,
      external_account_id: p.id,
      page_access_token: p.access_token,
      config: { page_id: p.id, page_name: p.name },
      label: p.name,
    }));
  }
  if (channel === "instagram" || channel === "ig_comment") {
    return pages
      .filter((p) => p.instagram_business_account_id)
      .map((p) => ({
        channel,
        external_account_id: p.instagram_business_account_id!,
        page_access_token: p.access_token,
        config: {
          page_id: p.id,
          page_name: p.name,
          ig_user_id: p.instagram_business_account_id,
        },
        label: `${p.name} (Instagram)`,
      }));
  }
  return [];
}

async function discoverWhatsAppAccounts(userAccessToken: string): Promise<DiscoveredAccount[]> {
  // List WABAs the user owns/manages.
  const bizUrl = `${GRAPH}/me/businesses?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`;
  const bizRes = await fetch(bizUrl);
  if (!bizRes.ok) return [];
  const bizJson = (await bizRes.json()) as { data?: Array<{ id: string; name: string }> };

  const accounts: DiscoveredAccount[] = [];
  for (const b of bizJson.data ?? []) {
    const wabaUrl = `${GRAPH}/${b.id}/owned_whatsapp_business_accounts?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`;
    const wabaRes = await fetch(wabaUrl);
    if (!wabaRes.ok) continue;
    const wabaJson = (await wabaRes.json()) as { data?: Array<{ id: string; name: string }> };
    for (const w of wabaJson.data ?? []) {
      const phoneUrl = `${GRAPH}/${w.id}/phone_numbers?access_token=${encodeURIComponent(userAccessToken)}`;
      const phoneRes = await fetch(phoneUrl);
      if (!phoneRes.ok) continue;
      const phoneJson = (await phoneRes.json()) as {
        data?: Array<{ id: string; display_phone_number: string; verified_name: string }>;
      };
      for (const ph of phoneJson.data ?? []) {
        accounts.push({
          channel: "whatsapp",
          external_account_id: ph.id,
          page_access_token: userAccessToken, // WhatsApp uses the user/system-user token.
          config: {
            phone_number_id: ph.id,
            waba_id: w.id,
            business_id: b.id,
            display_phone_number: ph.display_phone_number,
            verified_name: ph.verified_name,
          },
          label: `${ph.verified_name} (${ph.display_phone_number})`,
        });
      }
    }
  }
  return accounts;
}

/**
 * Subscribes the connected page (or IG account) to the right Meta
 * webhook fields so inbound messages + comments start streaming into
 * /api/channels/:channel/webhook. Idempotent — calling twice is safe.
 */
export async function subscribePageToWebhooks(args: {
  channel: Channel;
  pageId: string;
  pageAccessToken: string;
  igUserId?: string;
}): Promise<void> {
  const subscribedFields = fieldsForChannel(args.channel);
  if (subscribedFields.length === 0) return;

  if (args.channel === "instagram" || args.channel === "ig_comment") {
    // For IG we subscribe via the page (the IG Business account inherits).
    // Newer Graph: also subscribe the IG user directly for messaging fields.
    const r = await fetch(
      `${GRAPH}/${args.pageId}/subscribed_apps?subscribed_fields=${subscribedFields.join(",")}&access_token=${encodeURIComponent(args.pageAccessToken)}`,
      { method: "POST" },
    );
    if (!r.ok) {
      const detail = await r.text();
      throw new Error(`[meta] page subscribe failed (${r.status}): ${detail}`);
    }
    // Some scopes (instagram_manage_messages) also require subscribing
    // the IG user object directly.
    if (args.igUserId) {
      await fetch(
        `${GRAPH}/${args.igUserId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions&access_token=${encodeURIComponent(args.pageAccessToken)}`,
        { method: "POST" },
      );
    }
    return;
  }

  // FB messenger / comments — subscribe the page.
  const r = await fetch(
    `${GRAPH}/${args.pageId}/subscribed_apps?subscribed_fields=${subscribedFields.join(",")}&access_token=${encodeURIComponent(args.pageAccessToken)}`,
    { method: "POST" },
  );
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`[meta] page subscribe failed (${r.status}): ${detail}`);
  }
}

function fieldsForChannel(channel: Channel): string[] {
  switch (channel) {
    case "messenger":
      return ["messages", "messaging_postbacks", "message_reactions", "message_deliveries", "message_reads"];
    case "fb_comment":
      return ["feed"];
    case "instagram":
      return ["messages", "messaging_postbacks", "message_reactions"];
    case "ig_comment":
      return ["comments"];
    default:
      return [];
  }
}
