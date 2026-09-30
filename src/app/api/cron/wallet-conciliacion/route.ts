import {
  apifyVariableCost,
  type ApifyRunReceipt,
} from '@/lib/instagram-agent/apify-billing';
import { resolveWorkspaceKeyConOrigen } from '@/lib/integrations/workspace-key';
import { cancelar, liquidar } from '@/lib/wallet/operacion';
import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { withCronRun } from '@/lib/cron/heartbeat';
import { aplicarEvento, stripe, stripeDisponible } from '@/lib/billing/stripe';
import { reconcileSubscriptionInvoices } from '@/lib/billing/pending-payment';
import { acreditarDesdeEvento } from '@/lib/wallet/recarga';
import type Stripe from 'stripe';
async function handler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const { data: pending, error } = await db
    .from('wallet_operaciones')
    .select('id,workspace_id,concepto,proveedor,created_at,detalle')
    .eq('estado', 'reservada')
    // Number holds include prepaid renewals and have their own reconciler.
    .neq('concepto', 'numero_telefono')
    .lt('created_at', since)
    .order('created_at')
    .limit(200);
  if (error) throw new Error('wallet_reconciliation_unavailable');
  let recovered = 0;
  let released = 0;
  const unresolved = [];
  const paymentFailures: string[] = [];
  let subscriptionPayments = { synced: 0, failures: [] as string[] };
  if (stripeDisponible()) {
    try {
      subscriptionPayments = await reconcileSubscriptionInvoices(db, stripe(), id => aplicarEvento(db,
        { type: 'customer.subscription.updated', data: { object: { id } } } as unknown as Stripe.Event, false));
    } catch {
      subscriptionPayments.failures.push('reconciliation_unavailable');
    }
  }
  for (const op of pending ?? []) {
    if (op.proveedor === 'apify' && typeof op.detalle?.runId === 'string') {
      try {
        const key = await resolveWorkspaceKeyConOrigen(
          db,
          op.workspace_id,
          'apify',
          process.env.APIFY_TOKEN ?? process.env.APIFY_API_TOKEN ?? null
        );
        if (!key || key.propia)
          throw new Error('wallet_apify_platform_key_unavailable');
        const res = await fetch(
          'https://api.apify.com/v2/actor-runs/' +
            encodeURIComponent(op.detalle.runId),
          {
            headers: { authorization: 'Bearer ' + key.key },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (!res.ok) throw new Error('wallet_apify_receipt_unavailable');
        const run = (await res.json()).data as ApifyRunReceipt;
        if (
          !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)
        )
          throw new Error('wallet_apify_run_pending');
        await liquidar(
          { db, workspaceId: op.workspace_id, concepto: op.concepto },
          op.id,
          'apify',
          apifyVariableCost(run),
          { runId: run.id }
        );
        recovered++;
        continue;
      } catch {
        /* Keep unknown outcomes reserved for review. */
      }
    }
    if (
      op.proveedor === 'firecrawl' &&
      typeof op.detalle?.crawlId === 'string'
    ) {
      try {
        const res = await fetch(
          'https://api.firecrawl.dev/v1/crawl/' +
            encodeURIComponent(op.detalle.crawlId),
          {
            headers: {
              authorization: 'Bearer ' + process.env.FIRECRAWL_API_KEY,
            },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (!res.ok) throw new Error('wallet_crawl_unavailable');
        const json = await res.json(),
          rate = op.detalle.rate;
        if (
          !['completed', 'failed'].includes(json.status) ||
          !Number.isSafeInteger(json.creditsUsed) ||
          json.creditsUsed < 0 ||
          typeof rate !== 'number' ||
          !Number.isFinite(rate) ||
          rate <= 0
        )
          throw new Error('wallet_crawl_pending');
        await liquidar(
          { db, workspaceId: op.workspace_id, concepto: op.concepto },
          op.id,
          'firecrawl',
          json.creditsUsed * rate,
          { crawlId: op.detalle.crawlId, creditsUsed: json.creditsUsed, rate },
          json.creditsUsed
        );
        recovered++;
        continue;
      } catch {
        /* Keep unknown outcomes reserved for review. */
      }
    }
    // Sin identificador del proveedor no existe un recibo que consultar. Es
    // el rastro de una llamada cuya respuesta se perdió antes de guardar el
    // ID externo; mantenerla reservada para siempre no mejora la precisión y
    // deja dinero del comercio bloqueado. Después de 24 h se libera a favor
    // del comercio. Las operaciones que sí tienen runId/crawlId siguen bajo
    // conciliación normal y nunca pasan por este camino.
    const ageMs = Date.now() - new Date(op.created_at).getTime();
    const hasReceipt =
      typeof op.detalle?.runId === 'string' ||
      typeof op.detalle?.crawlId === 'string';
    if (!hasReceipt && ageMs >= 24 * 60 * 60 * 1000) {
      try {
        await cancelar(
          { db, workspaceId: op.workspace_id, concepto: op.concepto },
          op.id,
        );
        released++;
        continue;
      } catch {
        // Conservarla para revisión si ni siquiera se puede liberar de forma
        // transaccional; ése sí es un fallo real de conciliación.
      }
    }
    unresolved.push(op);
  }
  // Repair successful automatic payments independently of card retries or provider usage.
  if (stripeDisponible()) {
    const { data: attempts, error: attemptError } = await db
      .from('wallet_auto_intentos')
      .select('id,payment_intent_id')
      .eq('estado', 'pendiente')
      .not('payment_intent_id', 'is', null)
      .limit(100);
    if (attemptError) throw new Error(attemptError.message);
    for (const attempt of attempts ?? []) {
      try {
        const pi = await stripe().paymentIntents.retrieve(
          attempt.payment_intent_id
        );
        if (pi.status !== 'succeeded') continue;
        await acreditarDesdeEvento(db, {
          type: 'payment_intent.succeeded',
          data: { object: pi },
        } as unknown as Stripe.Event);
        const update = await db
          .from('wallet_auto_intentos')
          .update({ estado: 'completada' })
          .eq('id', attempt.id);
        if (update.error) throw new Error(update.error.message);
        recovered++;
      } catch {
        // One provider outage or rejected receipt must not block other merchants.
        // Leave this attempt pending: crediting is idempotent when retried.
        paymentFailures.push(attempt.id);
      }
    }
  }
  // Waiting inside the documented 24h settlement window is not a broken
  // reconciler. Keep these reservations visible in Admin as a separate
  // warning. Provider receipt errors and failed overdue releases still fail.
  const waiting = unresolved.filter(op => {
    const ageMs = Date.now() - new Date(op.created_at).getTime();
    return Number.isFinite(ageMs) && ageMs < 24 * 60 * 60 * 1000
      && typeof op.detalle?.runId !== 'string' && typeof op.detalle?.crawlId !== 'string';
  });
  const failed = unresolved.length > waiting.length || paymentFailures.length > 0 || subscriptionPayments.failures.length > 0;
  return NextResponse.json(
    { ok: !failed, pending: unresolved, waiting: waiting.length, paymentFailures, recovered, released, subscriptionPayments },
    { status: failed ? 207 : 200 }
  );
}
export const GET = withCronRun('wallet-conciliacion', handler);
export const POST = GET;
export const dynamic = 'force-dynamic';
