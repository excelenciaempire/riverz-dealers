import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { listConnections } from "@/lib/channels/connections";
import { decrypt } from "@/lib/channels/encryption";
import { assertCronAuth } from "@/lib/auth/cron";
import { getLogger } from "@/lib/log/logger";
import {
  subscribePageToWebhooks,
  getSubscribedFields,
  pageFieldsForChannel,
  getAppWebhookSubscriptions,
  appSubscriptionGaps,
  appWebhookBaseUrl,
  setAppWebhookSubscription,
  subscribeWabaToWebhooks,
  isWabaSubscribed,
} from "@/lib/channels/meta-graph";
import type { ChannelConnection, Channel } from "@/types";
import { withCronRun } from "@/lib/cron/heartbeat";
import {
  DEFAULT_CONNECTION_CONCURRENCY,
  forEachWithConcurrency,
} from "@/lib/async/concurrency";

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
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const admin = supabaseAdmin();
  // error/expired incluidos, no sólo connected: el ENRUTADOR del webhook sigue
  // ingiriendo para error/expired (la suscripción es a nivel app, no de token),
  // así que la superficie de MANTENIMIENTO tiene que ser la misma — si no, una
  // página trabada en 'error' nunca vuelve a aplicar su suscripción y, si Meta
  // la desuscribe tras una caída, muere en silencio para siempre.
  const list = await listConnections(admin, {
    channels: ["messenger", "instagram", "fb_comment", "ig_comment"],
  });

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

  await forEachWithConcurrency(
    list,
    DEFAULT_CONNECTION_CONCURRENCY,
    async (c) => {
      const secrets = (c.secrets ?? {}) as Record<string, unknown>;
      const enc = String(secrets.access_token ?? "");
      if (!enc) {
        skipped++;
        return;
      }
      let token: string;
      try {
        token = decrypt(enc);
      } catch {
        log.warn("could not decrypt page token", {
          id: c.id,
          channel: c.channel,
        });
        skipped++;
        return;
      }

      const cfg = (c.config ?? {}) as Record<string, unknown>;
      const pageId = String(cfg.page_id ?? c.external_account_id ?? "");
      const igUserId = cfg.ig_user_id as string | undefined;
      if (!pageId) {
        skipped++;
        return;
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
      const missing = verified
        ? expected.filter((f) => !actual.includes(f))
        : [];
      if (verified && missing.length > 0) {
        log.warn("page still missing webhook fields after re-subscribe", {
          id: c.id,
          channel: c.channel,
          pageId,
          missing,
          actual,
        });
      } else if (!verified) {
        log.warn(
          "could not verify webhook subscription (transient Graph error)",
          {
            id: c.id,
            channel: c.channel,
            pageId,
          },
        );
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
    },
  );

  // WhatsApp WABAs — reconcile the per-WABA app subscription. Embedded Signup
  // registers the app on the WABA at connect, but best-effort and never
  // re-applied; a dropped subscription silently stops ALL WhatsApp inbound +
  // echo sync while the connection still shows connected. Field selection is
  // app-level (dashboard), so here we only ensure the app stays registered.
  const waConns = await listConnections(admin, { channel: "whatsapp" });
  const waResults: Array<{
    id: string;
    wabaId: string;
    reapplied: boolean;
    subscribed: boolean | null;
  }> = [];
  let waMissing = 0;
  await forEachWithConcurrency(
    (waConns ?? []) as ChannelConnection[],
    DEFAULT_CONNECTION_CONCURRENCY,
    async (c) => {
      const secrets = (c.secrets ?? {}) as Record<string, unknown>;
      const enc = String(secrets.access_token ?? "");
      const cfg = (c.config ?? {}) as Record<string, unknown>;
      const wabaId = String(cfg.waba_id ?? "");
      if (!enc || !wabaId) {
        skipped++;
        return;
      }
      let token: string;
      try {
        token = decrypt(enc);
      } catch {
        skipped++;
        return;
      }
      const reapplied = await subscribeWabaToWebhooks(wabaId, token);
      const subscribed = await isWabaSubscribed(wabaId, token);
      if (subscribed === false) {
        waMissing++;
        log.warn("WABA not subscribed to the app after re-apply", {
          id: c.id,
          wabaId,
        });
      } else if (subscribed === true) {
        healthy++;
      }
      waResults.push({ id: c.id, wabaId, reapplied, subscribed });
    },
  );

  // APP-LEVEL subscription check. Per-page subscribed_apps (above) covers FB
  // `feed` + DM fields, but IG `comments` is subscribed ONLY at the app level
  // (one global toggle for every merchant) and is invisible to the per-page
  // verify. If that toggle breaks, EVERY merchant silently stops receiving IG
  // comments — so we read the app subscriptions directly and flag any gap.
  const appSubs = await getAppWebhookSubscriptions();
  let appGaps = appSubs ? appSubscriptionGaps(appSubs) : [];
  if (appSubs === null) {
    log.warn(
      "could not read app-level webhook subscriptions (no creds or transient)",
    );
  } else if (appGaps.length > 0) {
    log.warn(
      "app-level webhook subscription GAPS — some channels stop receiving for ALL merchants",
      {
        gaps: appGaps,
        expectedBase: appWebhookBaseUrl(),
      },
    );
  }

  // AUTO-REPARACIÓN del callback_url. Cuando el servicio cambia de dominio, la
  // suscripción sigue "activa" apuntando al host viejo: Meta entrega a un
  // servidor muerto y la bandeja deja de recibir sin un solo error. Reescribir
  // la suscripción es el mismo POST idempotente del portal, así que lo hacemos
  // acá en vez de esperar a que alguien lo note. Los otros huecos (campo
  // faltante, objeto inactivo) NO se auto-reparan: se configuran en el
  // dashboard y adivinarlos sería pisar una decisión del panel.
  const callbackFixes: Array<{
    object: string;
    from: string;
    to: string;
    ok: boolean;
  }> = [];
  for (const gap of appGaps) {
    if (!gap.wrongCallback || !appSubs) continue;
    const sub = appSubs[gap.object];
    const ok = await setAppWebhookSubscription(
      gap.object,
      sub.fields,
      gap.expectedCallbackUrl,
    );
    callbackFixes.push({
      object: gap.object,
      from: gap.callbackUrl,
      to: gap.expectedCallbackUrl,
      ok,
    });
    log[ok ? "warn" : "error"](
      ok
        ? "app-level callback_url repuntado al dominio actual"
        : "no se pudo repuntar el callback_url app-level",
      {
        object: gap.object,
        from: gap.callbackUrl,
        to: gap.expectedCallbackUrl,
      },
    );
  }
  // Releer para no reportar un hueco que acabamos de cerrar (y para que el 207
  // refleje lo que quedó, no lo que había).
  if (callbackFixes.some((f) => f.ok)) {
    const reread = await getAppWebhookSubscriptions();
    if (reread) appGaps = appSubscriptionGaps(reread);
  }

  // Flip the Render cron red (207) ONLY on a CONFIRMED gap, so a transient
  // verify failure doesn't cry wolf. Matches the gmail/outlook polls' use of
  // 207 for partial failure. A confirmed app-level gap is also a 207 — it's the
  // most severe case (all merchants), never a false alarm (we read it live).
  const anyMissing =
    results.some((r) => r.verified && r.missing.length > 0) || waMissing > 0;
  const anyAppGap = appGaps.length > 0;
  return NextResponse.json(
    {
      ok: !anyMissing && !anyAppGap,
      checked: list.length,
      healthy,
      skipped,
      results,
      waResults,
      appSubscriptions: appSubs,
      appGaps,
      callbackFixes,
    },
    { status: anyMissing || anyAppGap ? 207 : 200 },
  );
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("meta-webhook-subscriptions", cronHandler);
