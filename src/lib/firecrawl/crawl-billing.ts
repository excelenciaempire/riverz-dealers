import {
  cancelar,
  liquidar,
  reservar,
  type BillingContext,
} from '@/lib/wallet/operacion';
export function firecrawlCreditRate() {
  const rate = Number(process.env.FIRECRAWL_USAGE_USD_PER_CREDIT);
  if (!Number.isFinite(rate) || rate <= 0)
    throw new Error('wallet_firecrawl_rate_not_configured');
  return rate;
}
export function meteredCrawlFetch(ctx: BillingContext): typeof fetch {
  let operation: string | undefined;
  const rate = firecrawlCreditRate();
  return async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST') {
      const limit = JSON.parse(String(init.body)).limit;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30)
        throw new Error('wallet_invalid_crawl_limit');
      operation = await reservar(ctx, 'firecrawl', limit * rate, { rate });
    }
    const response = await fetch(input, init);
    if (!operation) throw new Error('wallet_crawl_operation_missing');
    if (!response.ok) {
      if (
        init?.method === 'POST' &&
        [400, 401, 402, 403, 404, 422, 429].includes(response.status)
      )
        await cancelar(ctx, operation);
      return response;
    }
    const json = await response.clone().json();
    if (init?.method === 'POST' && typeof json.id === 'string') {
      const saved = await ctx.db
        .from('wallet_operaciones')
        .update({ detalle: { ...ctx.detalle, crawlId: json.id, rate } })
        .eq('id', operation)
        .eq('workspace_id', ctx.workspaceId);
      if (saved.error) throw new Error('wallet_crawl_not_saved');
    }
    if (['completed', 'failed'].includes(json.status)) {
      if (!Number.isSafeInteger(json.creditsUsed) || json.creditsUsed < 0)
        throw new Error('wallet_crawl_receipt_missing');
      await liquidar(
        ctx,
        operation,
        'firecrawl',
        json.creditsUsed * rate,
        { crawlId: url.split('/').pop(), creditsUsed: json.creditsUsed, rate },
        json.creditsUsed
      );
    }
    return response;
  };
}
