/**
 * Meta Graph API helpers: page discovery, IG account resolution,
 * page-access-token exchange, and webhook subscription. Called by the
 * OAuth callback after a Meta connection completes so an admin doesn't
 * have to wire webhooks manually in developers.facebook.com.
 */

import crypto from "crypto";
import type { Channel } from "@/types";
import { getLogger } from "@/lib/log/logger";

const GRAPH = "https://graph.facebook.com/v21.0";
const log = getLogger("channels.meta-graph");

// ── appsecret_proof ──────────────────────────────────────────────
//
// Meta lets an app owner flip on "Require App Secret" (App Dashboard →
// Settings → Advanced → Security). With it on, EVERY Graph call made with
// an access token must also carry `appsecret_proof` — the HMAC-SHA256 of
// the access token keyed by the app secret — or Graph rejects the request
// (error 100, "API calls from the server require an appsecret_proof
// argument"). Without these helpers, turning that switch on would silently
// break every send, discovery and profile lookup across WhatsApp /
// Messenger / Instagram / comments.
//
// Attaching the proof when the switch is OFF is harmless — Graph accepts a
// valid proof either way — so we always send it whenever an access token is
// present and META_APP_SECRET is configured.

/**
 * HMAC-SHA256 (hex) of `accessToken` keyed by META_APP_SECRET, the value
 * Meta expects as `appsecret_proof`. Returns null when META_APP_SECRET is
 * unset (local/dev) or no token is supplied, so callers degrade gracefully
 * to a proof-less request instead of throwing.
 */
export function appsecretProof(accessToken: string | undefined | null): string | null {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !accessToken) return null;
  return crypto.createHmac("sha256", secret).update(accessToken).digest("hex");
}

/**
 * Append `&appsecret_proof=…` to a Graph URL that authenticates via an
 * `access_token` query param (or a Bearer header — the proof is the same
 * either way). No-op when the proof can't be computed. Use for GET/DELETE
 * and any call whose token rides in the URL.
 */
export function withAppsecretProof(url: string, accessToken: string | undefined | null): string {
  const proof = appsecretProof(accessToken);
  if (!proof) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}appsecret_proof=${proof}`;
}

/**
 * Merge `appsecret_proof` into a JSON request body that already carries
 * `access_token` (the Messenger / Instagram / comment Send API shape).
 * Returns the body unchanged when the proof can't be computed.
 */
export function withAppsecretProofBody<T extends Record<string, unknown>>(
  body: T,
  accessToken: string | undefined | null,
): T & { appsecret_proof?: string } {
  const proof = appsecretProof(accessToken);
  if (!proof) return body;
  return { ...body, appsecret_proof: proof };
}

export interface CommentItem {
  id: string;
  text: string;
  from: string | null;
  /** ISO-ish timestamp as returned by Graph (FB: created_time, IG: timestamp). */
  createdAt: string | null;
}

/**
 * Read the customer comments left on a Page post (FB) or IG media — i.e.
 * user-generated content — straight from the Graph API. This is the live
 * read that exercises `pages_read_user_content` (FB) and
 * `instagram_manage_comments` (IG); the inbox uses it to show the comment
 * thread in context next to the reply box.
 *
 * `postOrMediaId` is the conversation's `thread_external_id` (set to the
 * comment's post/media id by inbox-writer). Best-effort: returns null on
 * any failure so the thread view never breaks.
 */
export async function fetchPostComments(
  accessToken: string,
  postOrMediaId: string,
  channel: "fb_comment" | "ig_comment",
  limit = 25,
): Promise<CommentItem[] | null> {
  try {
    const fields =
      channel === "ig_comment"
        ? "id,text,username,timestamp"
        : "id,message,from,created_time";
    const url = withAppsecretProof(
      `${GRAPH}/${postOrMediaId}/comments?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`,
      accessToken,
    );
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = (await r.json()) as {
      data?: Array<{
        id?: string;
        message?: string;
        text?: string;
        from?: { name?: string };
        username?: string;
        created_time?: string;
        timestamp?: string;
      }>;
    };
    return (j.data ?? []).map((c) => ({
      id: String(c.id ?? ""),
      text: String(c.message ?? c.text ?? ""),
      from: c.from?.name ?? c.username ?? null,
      createdAt: c.created_time ?? c.timestamp ?? null,
    }));
  } catch {
    return null;
  }
}

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
  const url = withAppsecretProof(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id}&access_token=${encodeURIComponent(userAccessToken)}`,
    userAccessToken,
  );
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
  const bizUrl = withAppsecretProof(
    `${GRAPH}/me/businesses?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`,
    userAccessToken,
  );
  const bizRes = await fetch(bizUrl);
  if (!bizRes.ok) return [];
  const bizJson = (await bizRes.json()) as { data?: Array<{ id: string; name: string }> };

  const accounts: DiscoveredAccount[] = [];
  for (const b of bizJson.data ?? []) {
    const wabaUrl = withAppsecretProof(
      `${GRAPH}/${b.id}/owned_whatsapp_business_accounts?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`,
      userAccessToken,
    );
    const wabaRes = await fetch(wabaUrl);
    if (!wabaRes.ok) continue;
    const wabaJson = (await wabaRes.json()) as { data?: Array<{ id: string; name: string }> };
    for (const w of wabaJson.data ?? []) {
      const phoneUrl = withAppsecretProof(
        `${GRAPH}/${w.id}/phone_numbers?access_token=${encodeURIComponent(userAccessToken)}`,
        userAccessToken,
      );
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
    withAppsecretProof(
      `${GRAPH}/${args.pageId}/subscribed_apps?subscribed_fields=${pageFields.join(",")}&access_token=${encodeURIComponent(args.pageAccessToken)}`,
      args.pageAccessToken,
    ),
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
      withAppsecretProof(
        `${GRAPH}/${args.igUserId}/subscribed_apps?subscribed_fields=${userFields.join(",")}&access_token=${encodeURIComponent(args.pageAccessToken)}`,
        args.pageAccessToken,
      ),
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
      withAppsecretProof(
        `${GRAPH}/${objectId}/subscribed_apps?access_token=${encodeURIComponent(pageAccessToken)}`,
        pageAccessToken,
      ),
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
  // Echoes of messages the merchant sends from the Messenger app / Business
  // Suite, so those replies sync into Riverz too (multichannel). Delivered as
  // `message.is_echo`; ingested outbound. (IG delivers echoes under `messages`
  // already, so IG_* fields don't need this — and adding an unsupported field
  // to the IG object would 400 the whole subscribe, like `comments`.)
  "message_echoes",
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
