import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { encrypt, decrypt } from "@/lib/channels/encryption";
import { assertCronAuth } from "@/lib/auth/cron";
import { getLogger } from "@/lib/log/logger";
import { listUserPages } from "@/lib/channels/meta-graph";
import type { ChannelConnection, Channel } from "@/types";

const log = getLogger("cron.meta-token-refresh");

const GRAPH = "https://graph.facebook.com/v21.0";

/** Meta page / IG channels. WhatsApp is excluded — it runs on a
 *  permanent system-user token, not the 60-day Facebook Login token. */
const META_CHANNELS = ["messenger", "instagram", "fb_comment", "ig_comment"];

/** A Facebook Login long-lived user token lives ~60 days. We refresh once it
 *  is within this many days of death so a slow/failed run still has slack
 *  before the connection goes deaf. ~day 55 of a 60-day token. */
const REFRESH_WINDOW_DAYS = 5;
/** Lifetime we assume for a freshly exchanged long-lived user token. Used to
 *  (a) infer an age-based expiry when no `access_token_expires_at` is stored,
 *  and (b) stamp the new `access_token_expires_at` after a successful swap. */
const LONG_LIVED_TOKEN_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/cron/meta-token-refresh
 *
 * Refreshes the long-lived (~60-day) Facebook Login token behind every
 * connected Meta page / IG connection BEFORE it expires. Without this, a
 * Messenger / Instagram / FB-comment connection silently dies around day 60
 * and the inbox stops receiving DMs and comments until an admin reconnects
 * by hand.
 *
 * For each connection whose token is within ~5 days of expiry (read from
 * `secrets.access_token_expires_at`, falling back to an age estimate off
 * `updated_at` / `created_at`):
 *   1. Exchange the stored long-lived USER token for a fresh one via
 *      `fb_exchange_token` (grant_type=fb_exchange_token, META_APP_ID /
 *      META_APP_SECRET). Re-exchanging a long-lived token resets its ~60-day
 *      clock.
 *   2. Re-derive the PAGE-scoped token from `/me/accounts` with the fresh
 *      user token (page tokens stay valid only as long as the user token).
 *   3. Re-encrypt both with the same AES-256-GCM scheme the connect flow
 *      uses and write them back to `secrets`, stamping a new
 *      `access_token_expires_at` 60 days out.
 *
 * Fail-soft per connection: one bad token never tumbles the rest. Auth:
 * `x-cron-secret` matches AUTOMATION_CRON_SECRET. Idempotent — a connection
 * not yet inside the window is skipped, so re-running is harmless.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ error: "Meta app not configured" }, { status: 503 });
  }

  const admin = supabaseAdmin();
  const { data: conns } = await admin
    .from("channel_connections")
    .select("*")
    .in("channel", META_CHANNELS)
    .eq("status", "connected");
  const list = (conns ?? []) as ChannelConnection[];

  const now = Date.now();
  const results: Array<{
    id: string;
    channel: Channel;
    refreshed: boolean;
    skipped: boolean;
    reason?: string;
  }> = [];
  let refreshed = 0;
  let failed = 0;

  for (const c of list) {
    const secrets = (c.secrets ?? {}) as Record<string, unknown>;

    // Only act on connections nearing expiry. Prefer the stored expiry; fall
    // back to an age estimate off the row's last write timestamp.
    const expiresAt = estimateExpiry(secrets, c);
    if (expiresAt - now > REFRESH_WINDOW_DAYS * DAY_MS) {
      results.push({ id: c.id, channel: c.channel, refreshed: false, skipped: true, reason: "not_due" });
      continue;
    }

    // We extend the USER token (the long-lived one that keeps page tokens
    // alive). Without it there is nothing to re-exchange.
    const encUserToken = String(secrets.user_access_token ?? "");
    if (!encUserToken) {
      log.warn("no user_access_token to refresh", { id: c.id, channel: c.channel });
      results.push({ id: c.id, channel: c.channel, refreshed: false, skipped: true, reason: "no_user_token" });
      continue;
    }

    let userToken: string;
    try {
      userToken = decrypt(encUserToken);
    } catch {
      log.warn("could not decrypt user token", { id: c.id, channel: c.channel });
      results.push({ id: c.id, channel: c.channel, refreshed: false, skipped: true, reason: "decrypt_failed" });
      continue;
    }

    try {
      // 1. Re-exchange the long-lived user token for a fresh ~60-day one.
      const fresh = await exchangeLongLivedToken(userToken, appId, appSecret);
      if (!fresh) {
        failed++;
        results.push({ id: c.id, channel: c.channel, refreshed: false, skipped: false, reason: "exchange_failed" });
        continue;
      }

      // 2. Re-derive the page-scoped token from /me/accounts with the fresh
      //    user token. Page tokens are minted per page and stay valid only as
      //    long as the user token behind them, so refreshing the user token
      //    without re-minting would leave a page token on the old clock.
      const pageToken = await derivePageToken(fresh, c).catch(() => undefined);

      // 3. Re-encrypt with the same AES-256-GCM scheme connect uses and write
      //    back, stamping a new 60-day expiry. Keep the existing page token if
      //    we couldn't re-derive one (the user-token refresh alone still
      //    extends page-token life), so we never blank a working secret.
      const nextSecrets: Record<string, unknown> = {
        ...secrets,
        user_access_token: encrypt(fresh),
        access_token_expires_at: new Date(now + LONG_LIVED_TOKEN_DAYS * DAY_MS).toISOString(),
      };
      if (pageToken) nextSecrets.access_token = encrypt(pageToken);

      const { error: updErr } = await admin
        .from("channel_connections")
        .update({ secrets: nextSecrets, updated_at: new Date(now).toISOString() })
        .eq("id", c.id);
      if (updErr) {
        log.warn("token refresh DB update failed", { id: c.id, channel: c.channel, error: updErr.message });
        failed++;
        results.push({ id: c.id, channel: c.channel, refreshed: false, skipped: false, reason: "db_update_failed" });
        continue;
      }

      refreshed++;
      results.push({
        id: c.id,
        channel: c.channel,
        refreshed: true,
        skipped: false,
        reason: pageToken ? undefined : "user_token_only",
      });
      log.info("refreshed Meta token", { id: c.id, channel: c.channel, pageToken: Boolean(pageToken) });
    } catch (err) {
      // Fail-soft: a single connection's failure must not abort the loop.
      log.warn("token refresh failed", {
        id: c.id,
        channel: c.channel,
        error: err instanceof Error ? err.message : String(err),
      });
      failed++;
      results.push({ id: c.id, channel: c.channel, refreshed: false, skipped: false, reason: "error" });
    }
  }

  // 207 on any genuine failure (an attempt that errored), so the Render cron
  // surfaces a partial failure — matching the gmail/outlook polls and the
  // meta-webhook-subscriptions cron. A merely "not due" connection is a skip,
  // not a failure.
  return NextResponse.json(
    { ok: failed === 0, checked: list.length, refreshed, failed, results },
    { status: failed > 0 ? 207 : 200 },
  );
}

/**
 * Best-estimate of when this connection's long-lived token dies. Prefers the
 * explicit `access_token_expires_at` stamped at connect/refresh time; falls
 * back to assuming a 60-day life from the row's most recent write
 * (`updated_at`, then `created_at`).
 */
function estimateExpiry(secrets: Record<string, unknown>, c: ChannelConnection): number {
  const stored = secrets.access_token_expires_at;
  if (stored) {
    const t = new Date(String(stored)).getTime();
    if (Number.isFinite(t)) return t;
  }
  const base = c.updated_at ?? c.created_at;
  const baseMs = base ? new Date(base).getTime() : Date.now();
  return (Number.isFinite(baseMs) ? baseMs : Date.now()) + LONG_LIVED_TOKEN_DAYS * DAY_MS;
}

/**
 * Swap a long-lived user token for a fresh one. Re-exchanging an already
 * long-lived token via `fb_exchange_token` returns a new token with a reset
 * ~60-day clock. Returns the new token, or undefined if Meta rejected it
 * (e.g. the user de-authorized the app — nothing this cron can recover).
 */
async function exchangeLongLivedToken(
  userToken: string,
  appId: string,
  appSecret: string,
): Promise<string | undefined> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", userToken);
  const r = await fetch(url.toString());
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    log.warn("fb_exchange_token failed", { status: r.status, detail: detail.slice(0, 300) });
    return undefined;
  }
  const j = (await r.json()) as { access_token?: string };
  return j.access_token?.trim() || undefined;
}

/**
 * Re-mint this connection's page-scoped token from `/me/accounts` using the
 * fresh user token. Matches the page by id (page_id / external_account_id) so
 * we update the right page's token even when the user manages several. For IG
 * channels the page token IS the page's access_token (IG DMs use the linked
 * page token), so the same lookup applies.
 */
async function derivePageToken(
  userToken: string,
  c: ChannelConnection,
): Promise<string | undefined> {
  const cfg = (c.config ?? {}) as Record<string, unknown>;
  const pageId = String(cfg.page_id ?? c.external_account_id ?? "");
  if (!pageId) return undefined;
  const pages = await listUserPages(userToken);
  const match = pages.find((p) => p.id === pageId);
  return match?.access_token;
}
