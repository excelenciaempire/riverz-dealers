import { afterEach, describe, expect, it, vi } from 'vitest';
import { firecrawlCreditRate, meteredCrawlFetch } from './crawl-billing';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Firecrawl monthly credits', () => {
  it('treats an omitted variable rate as zero', () => {
    vi.stubEnv('FIRECRAWL_USAGE_USD_PER_CREDIT', '');
    expect(firecrawlCreditRate()).toBe(0);
  });

  it('does not touch the wallet when credits come from a monthly plan', async () => {
    vi.stubEnv('FIRECRAWL_USAGE_USD_PER_CREDIT', '0');
    const transport = vi.fn().mockResolvedValue(Response.json({ id: 'crawl' }));
    vi.stubGlobal('fetch', transport);
    const rpc = vi.fn();
    const result = await meteredCrawlFetch({
      db: { rpc } as never,
      workspaceId: 'workspace',
      concepto: 'lectura_de_pagina',
    })('https://api.firecrawl.dev/v1/crawl', {
      method: 'POST',
      body: JSON.stringify({ limit: 30 }),
    });
    expect(result.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
