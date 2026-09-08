import {
  apifyVariableCost,
  type ApifyRunReceipt,
} from '@/lib/instagram-agent/apify-billing';
import { resolveWorkspaceKeyConOrigen } from '@/lib/integrations/workspace-key';
import { liquidar } from '@/lib/wallet/operacion';
import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { withCronRun } from '@/lib/cron/heartbeat';
import { stripe, stripeDisponible } from '@/lib/billing/stripe';
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
    .lt('created_at', since)
    .order('created_at')
    .limit(200);
  if (error) throw new Error('wallet_reconciliation_unavailable');
  let recovered = 0;
  const unresolved = [];
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
    }
  }
  return NextResponse.json(
    { ok: !unresolved.length, pending: unresolved, recovered },
    { status: unresolved.length ? 207 : 200 }
  );
}
export const GET = withCronRun('wallet-conciliacion', handler);
export const POST = GET;
export const dynamic = 'force-dynamic';
