import { beforeEach, afterEach, it, expect, vi } from 'vitest';
vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: vi.fn(() => ({})),
}));
vi.mock('@/lib/cron/heartbeat', () => ({
  withCronRun: (_name: string, handler: unknown) => handler,
}));
vi.mock('@/lib/shopify/post-purchase-guide-delivery', () => ({
  deliverPostPurchaseGuides: vi.fn(),
}));
import { deliverPostPurchaseGuides } from '@/lib/shopify/post-purchase-guide-delivery';
import { GET } from './route';
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'secret');
  vi.stubEnv('CRON_SECRET', '');
});
afterEach(() => vi.unstubAllEnvs());
it('rejects public requests before creating deliveries', async () => {
  const result = await GET(
    new Request('https://riverzai.com/api/cron/post-purchase-guides')
  );
  expect(result.status).toBe(401);
  expect(deliverPostPurchaseGuides).not.toHaveBeenCalled();
});
it('fails closed when no cron credential exists', async () => {
  vi.stubEnv('AUTOMATION_CRON_SECRET', '');
  const result = await GET(
    new Request('https://riverzai.com/api/cron/post-purchase-guides')
  );
  expect(result.status).toBe(503);
  expect(deliverPostPurchaseGuides).not.toHaveBeenCalled();
});
it('returns successful delivery counts for an authenticated run', async () => {
  vi.mocked(deliverPostPurchaseGuides).mockResolvedValue({
    scanned: 1,
    queued: 1,
    sent: 1,
    reconciled: 0,
    skipped: 0,
    failed: 0,
    uncertain: 0,
    errors: 0,
  });
  const result = await GET(
    new Request('https://riverzai.com/api/cron/post-purchase-guides', {
      headers: { 'x-cron-secret': 'secret' },
    })
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ sent: 1 });
});
it('reports uncertain delivery rather than a false success', async () => {
  vi.mocked(deliverPostPurchaseGuides).mockResolvedValue({
    scanned: 1,
    queued: 1,
    sent: 0,
    reconciled: 0,
    skipped: 0,
    failed: 0,
    uncertain: 1,
    errors: 0,
  });
  const result = await GET(
    new Request('https://riverzai.com/api/cron/post-purchase-guides', {
      headers: { 'x-cron-secret': 'secret' },
    })
  );
  expect(result.status).toBe(207);
});
