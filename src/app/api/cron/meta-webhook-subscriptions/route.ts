import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
import { assertCronAuth } from "@/lib/auth/cron";
import { getLogger } from "@/lib/log/logger";
import {
  subscribePageToWebhooks,
  getSubscribedFields,
  pageFieldsForChannel,
} from "@/lib/channels/meta-graph";
import type { ChannelConnection, Channel } from "@/types";

const log = getLogger("cron.meta-webhook-subscriptions");

/**
 * GET /api/cron/meta-webhook-subscriptions
 *
 * Keeps Meta webhook delivery healthy so the inbox never silently stops
 * receiving DMs or comments. Meta unsubscribes an app's page after
 * sustained webhook errors (5xx, timeouts) and never re-subscribes on its
 * own — when that happens, messages and comments just stop arriving with
 * no error anywhere. This cron, for every connected Meta page/IG account:
 *   1. RE-APPLIES the full field subscription (read-union-post — never
 *      drops a field another channel needs).
 *   2. VERIFIES the page is now subscribed to the fields it should be, and
 *      logs a warning naming any still-missing field (e.g. `comments` /
 *      `feed`) so a broken subscription is visible instead of silent.
 *
 * Auth: `x-cron-secret` matches AUTOMATION_CRON_SECRET. Idempotent.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const admin = supabaseAdmin();
  const { data: conns } = await admin
    .from("channel_connections")
    .select("*")
    .in("channel", ["messenger", "instagram", "fb_comment", "ig_comment"])
    .eq("status", "connected");
  const list = (conns ?? []) as ChannelConnection[];

  const results: Array<{
    id: string;
    channel: Channel;
    pageId: string;
    reapplied: boolean;
    verified: boolean;
    subscribed: string[];
    missing: string[];
  }> = [];
  let healthy = 0;
  let skipped = 0; // connections we couldn't even attempt (no/bad token, no page)

  for (const c of list) {
    const secrets = (c.secrets ?? {}) as Record<string, unknown>;
    const enc = String(secrets.access_token ?? "");
    if (!enc) {
      skipped++;
      continue;
    }
    let token: string;
    try {
      token = decrypt(enc);
    } catch {
      log.warn("could not decrypt page token", { id: c.id, channel: c.channel });
      skipped++;
      continue;
    }

    const cfg = (c.config ?? {}) as Record<string, unknown>;
    const pageId = String(cfg.page_id ?? c.external_account_id ?? "");
    const igUserId = cfg.ig_user_id as string | undefined;
    if (!pageId) {
      skipped++;
      continue;
    }

    // 1. Re-apply (best-effort; failure is logged, not fatal).
    let reapplied = false;
    try {
      await subscribePageToWebhooks({
        channel: c.channel,
        pageId,
        pageAccessToken: token,
        igUserId,
      });
      reapplied = true;
    } catch (err) {
      log.warn("re-subscribe failed", {
        id: c.id,
        channel: c.channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. Verify the page now carries this channel's required fields. A
    //    null read means the verify GET itself failed (transient) — that
    //    is NOT the same as "fields missing", so don't flip the cron red on
    //    it (would be a false alarm); only a confirmed missing field counts.
    const expected = pageFieldsForChannel(c.channel);
    const actual = await getSubscribedFields(pageId, token);
    const verified = actual !== null;
    const missing = verified ? expected.filter((f) => !actual.includes(f)) : [];
    if (verified && missing.length > 0) {
      log.warn("page still missing webhook fields after re-subscribe", {
        id: c.id,
        channel: c.channel,
        pageId,
        missing,
        actual,
      });
    } else if (!verified) {
      log.warn("could not verify webhook subscription (transient Graph error)", {
        id: c.id,
        channel: c.channel,
        pageId,
      });
    } else {
      healthy++;
    }

    results.push({
      id: c.id,
      channel: c.channel,
      pageId,
      reapplied,
      verified,
      subscribed: actual ?? [],
      missing,
    });
  }

  // Flip the Render cron red (207) ONLY on a CONFIRMED missing field, so a
  // transient verify failure doesn't cry wolf. Matches the gmail/outlook
  // polls' use of 207 for partial failure.
  const anyMissing = results.some((r) => r.verified && r.missing.length > 0);
  return NextResponse.json(
    { ok: !anyMissing, checked: list.length, healthy, skipped, results },
    { status: anyMissing ? 207 : 200 },
  );
}
