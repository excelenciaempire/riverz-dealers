/**
 * Meta Graph API helpers: page discovery, IG account resolution,
 * page-access-token exchange, and webhook subscription. Called by the
 * OAuth callback after a Meta connection completes so an admin doesn't
 * have to wire webhooks manually in developers.facebook.com.
 */

import type { Channel } from "@/types";
import { getLogger } from "@/lib/log/logger";

const GRAPH = "https://graph.facebook.com/v21.0";
const log = getLogger("channels.meta-graph");

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
  const familyFields = pageFieldsForChannel(args.channel);
  if (familyFields.length === 0) {
    // Defensive: only fires for a channel with no field map (a future
    // channel shipped without one) — log so it doesn't silently no-op.
    log.warn("no webhook fields defined for channel; skipping subscribe", {
      channel: args.channel,
    });
    return;
  }

  // Read the page's CURRENT subscribed fields and POST the UNION with this
  // family's fields. A single Meta page delivers both messaging AND
  // comment/feed webhooks, and `subscribed_apps` sets the field list per
  // app-page — so connecting (or reconnecting) just "instagram" must NOT
  // leave the page without `comments`, nor wipe `feed` from a page that
  // also has Messenger. Reading-then-unioning is robust whether Meta
  // merges or replaces the field set, and is order-independent.
  const currentPage = await getSubscribedFields(args.pageId, args.pageAccessToken);
  if (currentPage === null) {
    // Couldn't read existing fields (token/scope/transient). We still POST
    // this family's fields so THIS channel works, but warn — under
    // replace-semantics another family's fields could be lost until the
    // verify cron re-applies them.
    log.warn("could not read current page subscription; applying family fields only", {
      pageId: args.pageId,
      channel: args.channel,
    });
  }
  const pageFields = Array.from(new Set([...(currentPage ?? []), ...familyFields]));
  const r = await fetch(
    `${GRAPH}/${args.pageId}/subscribed_apps?subscribed_fields=${pageFields.join(",")}&access_token=${encodeURIComponent(args.pageAccessToken)}`,
    { method: "POST" },
  );
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`[meta] page subscribe failed (${r.status}): ${detail}`);
  }

  // IG messaging also requires subscribing the IG user object directly
  // (some scopes like instagram_manage_messages only deliver that way).
  if ((args.channel === "instagram" || args.channel === "ig_comment") && args.igUserId) {
    const currentUser = (await getSubscribedFields(args.igUserId, args.pageAccessToken)) ?? [];
    const userFields = Array.from(new Set([...currentUser, ...IG_USER_FIELDS]));
    const ur = await fetch(
      `${GRAPH}/${args.igUserId}/subscribed_apps?subscribed_fields=${userFields.join(",")}&access_token=${encodeURIComponent(args.pageAccessToken)}`,
      { method: "POST" },
    );
    // Best-effort (the page subscription above is the critical one), but a
    // failure here means IG DMs may not deliver — surface it instead of
    // swallowing it silently.
    if (!ur.ok) {
      const detail = await ur.text().catch(() => "");
      log.warn("IG user webhook subscribe failed", {
        igUserId: args.igUserId,
        status: ur.status,
        detail: detail.slice(0, 300),
      });
    }
  }
}

/**
 * Read the webhook fields THIS app is currently subscribed to on a page or
 * IG-user object. Returns the flattened `subscribed_fields`, or null if the
 * call fails (so callers treat "unknown" as "subscribe everything"). Used
 * by subscribePageToWebhooks (read-union-post) and the verify/repair cron.
 */
export async function getSubscribedFields(
  objectId: string,
  pageAccessToken: string,
): Promise<string[] | null> {
  try {
    const r = await fetch(
      `${GRAPH}/${objectId}/subscribed_apps?access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      data?: Array<{ id?: string; subscribed_fields?: unknown }>;
    };
    // GET /subscribed_apps can list MULTIPLE apps subscribed to the object
    // (e.g. Meta Business Suite alongside us). Only union in OUR app's
    // fields — folding in another app's fields and POSTing them back under
    // our subscription could include a field invalid for our scopes and
    // 400 the whole subscribe. Filter by our app id when we know it.
    const appId = process.env.META_APP_ID;
    const fields = new Set<string>();
    for (const app of j.data ?? []) {
      if (appId && app.id && String(app.id) !== appId) continue;
      const sf = app.subscribed_fields;
      // Meta returns either string[] or [{name}] depending on API version.
      if (Array.isArray(sf)) {
        for (const f of sf) {
          if (typeof f === "string") fields.add(f);
          else if (f && typeof f === "object" && typeof (f as { name?: unknown }).name === "string") {
            fields.add((f as { name: string }).name);
          }
        }
      }
    }
    return [...fields];
  } catch {
    return null;
  }
}

// Webhook fields per page "family". We subscribe the whole family union on
// every connect so DMs + comments are always both covered regardless of
// which channel triggered the subscription or the order pages were linked.
const FB_PAGE_FIELDS = [
  "messages",
  "messaging_postbacks",
  "message_reactions",
  "message_deliveries",
  "message_reads",
  "feed", // FB post/ad comments arrive under the `feed` field
];
// NOTE: `comments` is intentionally NOT here. IG comment webhooks are
// subscribed at the APP level (Meta App Dashboard › Instagram › Webhooks),
// not per-page via subscribed_apps — POSTing `comments` to a page's
// subscribed_apps 400s and would abort the whole subscribe (skipping the
// IG-user messaging subscribe below it). Verified in prod: the page has no
// `comments` field yet IG comments still arrive. Page-level IG handles
// messaging only; the ig-user object is subscribed separately.
const IG_PAGE_FIELDS = ["messages", "messaging_postbacks", "message_reactions"];
const IG_USER_FIELDS = ["messages", "messaging_postbacks", "message_reactions"];

/** The full set of page-level webhook fields to subscribe when connecting
 *  any channel in the page's family (FB page vs IG). Exported so the
 *  re-subscribe/verify cron applies the exact same set. */
export function pageFieldsForChannel(channel: Channel): string[] {
  switch (channel) {
    case "messenger":
    case "fb_comment":
      return FB_PAGE_FIELDS;
    case "instagram":
    case "ig_comment":
      return IG_PAGE_FIELDS;
    default:
      return [];
  }
}
