import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { listConnections } from "@/lib/channels/connections";
import { savePollState } from '@/lib/channels/poll-state';
import { reconcileTemplateStatus } from '@/lib/whatsapp/reconcile-template-status';
import { decrypt } from "@/lib/channels/encryption";
import { assertCronAuth } from "@/lib/auth/cron";
import { getLogger } from "@/lib/log/logger";
import {
  subscribePageToWebhooks,
  getSubscribedFields,
  pageFieldsForChannel,
  getAppWebhookSubscriptions,
  appSubscriptionGaps,
  APP_WEBHOOK_EXPECTATIONS,
  appWebhookBaseUrl,
  setAppWebhookSubscription,
  subscribeWabaToWebhooks,
  isWabaSubscribed,
  whatsappSubscriptionSnapshot,
} from "@/lib/channels/meta-graph";
import type { ChannelConnection, Channel } from "@/types";
import { withCronPayload, withCronRun } from "@/lib/cron/heartbeat";
import {
  DEFAULT_CONNECTION_CONCURRENCY,
  forEachWithConcurrency,
} from "@/lib/async/concurrency";
import {
  fetchWhatsAppAccountHealth,
  persistWhatsAppHealthSnapshot,
} from "@/lib/whatsapp/account-health";
import {
  diagnosticoCoexistencia,
  ensureCoexistenceHistorySync,
  historyWebhookLive,
} from "@/lib/channels/whatsapp/history-sync";
import { replayHistoryOnce } from "@/lib/channels/whatsapp/history-progress";
import {
  COEXISTENCE_ECHOES_MISSING,
  checkCoexistenceEchoes,
  type EchoCounts,
} from "@/lib/channels/whatsapp/echo-health";

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

      await savePollState(admin, c.id, {
        health_sync_checked_at: new Date().toISOString(),
        health_sync_error: !verified ? 'webhook_verification_unavailable' : missing.length ? `missing_webhook_fields:${missing.join(',')}` : null,
      }, null, { complete: false });
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
    healthRefreshed: boolean;
    healthCanSend: string | null;
    /** Coexistencia: null si no aplica. */
    echoesMissing: boolean | null;
  }> = [];
  let waMissing = 0;
  const waErrors: Array<{ id: string; error: string }> = [];
  const echoAlarms: Array<{ id: string; counts: EchoCounts | null }> = [];
  await forEachWithConcurrency(
    (waConns ?? []) as ChannelConnection[],
    DEFAULT_CONNECTION_CONCURRENCY,
    async (c) => {
      try {
      const secrets = (c.secrets ?? {}) as Record<string, unknown>;
      const enc = String(secrets.access_token ?? "");
      const cfg = (c.config ?? {}) as Record<string, unknown>;
      const wabaId = String(cfg.waba_id ?? "");
      const phoneNumberId = String(
        cfg.phone_number_id ?? c.external_account_id ?? "",
      );
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
      await reconcileTemplateStatus(admin, { workspaceId: c.workspace_id, wabaId, accessToken: token });
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
      // La salud cambia sin webhook (por ejemplo, cuando el comercio termina
      // de configurar la facturación). Si sólo se leyera al conectar, una
      // cuenta recuperada seguiría bloqueando sus automatizaciones para
      // siempre. El snapshot también reevalúa los flujos armados.
      let healthRefreshed = false;
      let healthCanSend: string | null = null;
      if (phoneNumberId) {
        const health = await fetchWhatsAppAccountHealth({
          phoneNumberId,
          wabaId,
          accessToken: token,
        });
        await persistWhatsAppHealthSnapshot(admin, c.id, health);
        healthRefreshed = true;
        healthCanSend = health.canSendMessage;
      }
      // Actividad de coexistencia, sólo diagnóstica: ningún eco puede significar
      // que el comercio atiende desde Riverz. La suscripción se verifica aparte.
      const echoes = await checkCoexistenceEchoes(admin, c);
      if (echoes?.alarm) echoAlarms.push({ id: c.id, counts: echoes.counts });
      waResults.push({
        id: c.id,
        wabaId,
        reapplied,
        subscribed,
        healthRefreshed,
        healthCanSend,
        echoesMissing: echoes ? echoes.alarm : null,
      });
      await savePollState(admin, c.id, {
        health_sync_checked_at: new Date().toISOString(),
        health_sync_error:
          subscribed !== true
            ? 'waba_subscription_unverified'
            : echoes?.alarm
              ? COEXISTENCE_ECHOES_MISSING
              : null,
        ...echoes?.patch,
      }, null, { complete: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        waErrors.push({ id: c.id, error: message });
        await savePollState(admin, c.id, { health_sync_error: message }, null, { complete: false });
      }
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

  // AUTO-REPARACIÓN app-level. El catálogo de campos esperados es explícito y
  // versionado arriba, así que unir esos campos a la suscripción viva no
  // adivina nada ni elimina decisiones del dashboard. También reactiva el
  // objeto y conserva cualquier campo adicional ya configurado.
  const subscriptionFixes: Array<{
    object: string;
    missing: string[];
    inactive: boolean;
    fields: string[];
    ok: boolean;
  }> = [];
  const callbackFixes: Array<{
    object: string;
    from: string;
    to: string;
    ok: boolean;
  }> = [];
  for (const gap of appGaps) {
    if (!appSubs) continue;
    const sub = appSubs[gap.object];
    // Si el objeto entero no existe no conocemos su ruta de callback. Se
    // conserva como hueco confirmado para intervención, sin inventarla.
    if (!sub?.callbackUrl) continue;
    const fields = Array.from(
      new Set([
        ...sub.fields,
        ...(APP_WEBHOOK_EXPECTATIONS[gap.object] ?? []),
      ]),
    );
    const callbackUrl = gap.wrongCallback
      ? gap.expectedCallbackUrl
      : sub.callbackUrl;
    const ok = await setAppWebhookSubscription(
      gap.object,
      fields,
      callbackUrl,
    );
    subscriptionFixes.push({
      object: gap.object,
      missing: gap.missing,
      inactive: gap.inactive,
      fields,
      ok,
    });
    if (gap.wrongCallback) {
      callbackFixes.push({
        object: gap.object,
        from: gap.callbackUrl,
        to: gap.expectedCallbackUrl,
        ok,
      });
    }
    log[ok ? "warn" : "error"](
      ok
        ? "suscripción app-level reparada"
        : "no se pudo reparar la suscripción app-level",
      {
        object: gap.object,
        missing: gap.missing,
        inactive: gap.inactive,
        from: gap.callbackUrl,
        to: callbackUrl,
      },
    );
  }
  // Releer para no reportar un hueco que acabamos de cerrar (y para que el 207
  // refleje lo que quedó, no lo que había).
  let liveSubs = appSubs;
  if (subscriptionFixes.some((f) => f.ok)) {
    const reread = await getAppWebhookSubscriptions();
    if (reread) {
      liveSubs = reread;
      appGaps = appSubscriptionGaps(reread);
    }
  }

  // Coexistencia: el historial de la app del comercio se pide una sola vez y
  // sólo en las 24 horas posteriores al onboarding. Va después de la
  // reparación: sin el campo `history` suscrito, Meta lo manda y se pierde.
  const historySync: Array<{ id: string; requested: boolean }> = [];
  if (historyWebhookLive(liveSubs)) {
    for (const c of (waConns ?? []) as ChannelConnection[]) {
      const requested = await ensureCoexistenceHistorySync(admin, c);
      if (requested !== null) historySync.push({ id: c.id, requested });
    }
  }

  // Y una hora después del pedido, una relectura del diario: las tandas se
  // procesan después de acusar recibo a Meta y un reinicio las corta sin que
  // Meta las vuelva a mandar. Una vez por pedido (history-progress.ts).
  const historyReplays: Array<{ id: string; ingested: number; error?: string }> = [];
  for (const c of (waConns ?? []) as ChannelConnection[]) {
    const replay = await replayHistoryOnce(admin, c);
    if (replay) historyReplays.push({ id: c.id, ...replay });
  }

  // Lo que hay que poder mirar después de la corrida. La suscripción de
  // WhatsApp va entera (campos, estado, host) porque es la primera sospecha
  // cuando faltan los ecos del teléfono del comercio.
  const whatsappSubscription = whatsappSubscriptionSnapshot(liveSubs);

  // Qué dice Meta del número de cada coexistencia (¿sigue en la app del
  // celular?), para diagnosticar cuando no llegan ni el historial ni los ecos.
  const coexistencia: Array<Record<string, unknown>> = [];
  for (const c of (waConns ?? []) as ChannelConnection[]) {
    const d = await diagnosticoCoexistencia(c);
    if (!d) continue;
    coexistencia.push(d);
    // El comercio sacó el número de la app del celular: ya no es coexistencia.
    // Si se queda marcado, la alarma de ecos avisa de algo que no puede pasar.
    const numero = d.numero as { status?: number; body?: string } | undefined;
    let enLaApp: unknown;
    try {
      enLaApp = numero?.status === 200 ? (JSON.parse(numero.body ?? "{}") as { is_on_biz_app?: unknown }).is_on_biz_app : undefined;
    } catch {
      enLaApp = undefined;
    }
    if (enLaApp === false) {
      const resto = { ...((c.config ?? {}) as Record<string, unknown>) };
      delete resto.health_sync_error;
      delete resto.echoes_missing_since;
      await admin
        .from("channel_connections")
        .update({ config: { ...resto, coexistence: false } })
        .eq("id", c.id);
    }
  }

  // Flip the Render cron red (207) ONLY on a CONFIRMED gap, so a transient
  // verify failure doesn't cry wolf. Matches the gmail/outlook polls' use of
  // 207 for partial failure. A confirmed app-level gap is also a 207 — it's the
  // most severe case (all merchants), never a false alarm (we read it live).
  const anyMissing =
    results.some((r) => !r.verified || r.missing.length > 0) || waResults.some(r => r.subscribed !== true) || waMissing > 0 || waErrors.length > 0 || skipped > 0;
  const anyAppGap = appGaps.length > 0;
  return withCronPayload(
    NextResponse.json(
      {
        ok: !anyMissing && !anyAppGap,
        checked: list.length,
        healthy,
        skipped,
        results,
        waResults,
        waErrors,
        appSubscriptions: appSubs,
        appGaps,
        subscriptionFixes,
        callbackFixes,
        historySync,
        whatsappSubscription,
        echoAlarms,
        historyReplays,
        coexistencia,
      },
      { status: anyMissing || anyAppGap ? 207 : 200 },
    ),
    { whatsappSubscription, echoAlarms, historyReplays, coexistencia },
  );
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("meta-webhook-subscriptions", cronHandler);
