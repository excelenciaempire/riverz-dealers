import { afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/cron/heartbeat', () => ({
  withCronRun: (_name: string, handler: (r: Request) => Promise<Response>) =>
    handler,
}));
vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
    }),
  }),
}));
vi.mock('@/lib/dealers/inventory-sync', () => ({
  syncDealerInventory: vi.fn(),
}));
import { GET } from './route';
afterEach(() => vi.unstubAllEnvs());
describe('dealer growth scheduler authentication', () => {
  it('accepts the same secret used by the production scheduler', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'test-scheduler-secret');
    const r = await GET(
      new Request('https://dealers.test/api/cron/dealer-growth', {
        headers: { 'x-cron-secret': 'test-scheduler-secret' },
      })
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ synced: 0, failed: 0 });
  });
  it('rejects an invalid secret before database work', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'test-scheduler-secret');
    expect(
      (
        await GET(
          new Request('https://dealers.test/api/cron/dealer-growth', {
            headers: { 'x-cron-secret': 'wrong' },
          })
        )
      ).status
    ).toBe(401);
  });
});
