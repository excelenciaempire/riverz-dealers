import {
  cancelar,
  liquidar,
  reservar,
  type BillingContext,
} from '@/lib/wallet/operacion';

export interface ApifyRunReceipt {
  id: string;
  status: string;
  defaultDatasetId?: string;
  usageTotalUsd?: number | null;
  pricingInfo?: { pricingModel?: string };
  usageUsd?: Record<string, number>;
}
export function apifyVariableCost(run: ApifyRunReceipt): number {
  // Monthly actor rental is never allocated to a customer. Only its itemized platform usage is eligible.
  const cost =
    run.pricingInfo?.pricingModel === 'FLAT_PRICE_PER_MONTH'
      ? run.usageUsd
        ? Object.values(run.usageUsd).reduce((a, b) => a + b, 0)
        : NaN
      : run.usageTotalUsd;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)
    throw new Error('wallet_apify_receipt_missing');
  return cost;
}
export async function runProfileBilled(
  ctx: BillingContext,
  token: string,
  actor: string,
  username: string
): Promise<Response> {
  const cap = Number(process.env.APIFY_PROFILE_MAX_USAGE_USD);
  if (!Number.isFinite(cap) || cap <= 0 || cap > 5)
    throw new Error('wallet_apify_budget_not_configured');
  const id = await reservar(ctx, 'apify', cap, { actor });
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  const result = await fetch(
    `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/runs?waitForFinish=60&timeout=60&maxItems=1&maxTotalChargeUsd=${cap}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ usernames: [username], resultsLimit: 6 }),
      signal: AbortSignal.timeout(75000),
    }
  );
  if (!result.ok) {
    if ([400, 401, 402, 403, 404, 422, 429].includes(result.status))
      await cancelar(ctx, id);
    return result;
  }
  const run = (await result.json()).data as ApifyRunReceipt;
  if (!run?.id) throw new Error('wallet_apify_run_missing');
  const saved = await ctx.db
    .from('wallet_operaciones')
    .update({ detalle: { ...ctx.detalle, actor, runId: run.id } })
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId);
  if (saved.error) throw new Error('wallet_apify_run_not_saved');
  if (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status))
    throw new Error('wallet_apify_run_pending');
  await liquidar(ctx, id, 'apify', apifyVariableCost(run), {
    runId: run.id,
    actor,
  });
  if (run.status !== 'SUCCEEDED' || !run.defaultDatasetId)
    return new Response('apify_run_failed', { status: 502 });
  return fetch(
    `https://api.apify.com/v2/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&limit=1`,
    { headers, signal: AbortSignal.timeout(15000) }
  );
}
