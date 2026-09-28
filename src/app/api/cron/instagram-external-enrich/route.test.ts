import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), enrich: vi.fn() }));
vi.mock('@/lib/auth/cron', () => ({ assertCronAuth: mocks.auth }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: mocks.db }));
vi.mock('@/lib/instagram-agent/external-enrich', () => ({ enrichExternalProfile: mocks.enrich }));
import { GET } from './route';

beforeEach(() => vi.resetAllMocks());
it('retires old callers without provider calls, wallet charges or fake success heartbeats', async () => {
  const response = await GET(new Request('https://example.test/api/cron/instagram-external-enrich'));
  expect(await response.json()).toEqual({ ok: true, disabled: true, reason: 'feature_retired' });
  expect(mocks.db).not.toHaveBeenCalled();
  expect(mocks.enrich).not.toHaveBeenCalled();
});
it('still rejects unauthenticated callers', async () => {
  mocks.auth.mockImplementation(() => { throw new Response(null, { status: 401 }); });
  expect((await GET(new Request('https://example.test/api/cron/instagram-external-enrich'))).status).toBe(401);
  expect(mocks.enrich).not.toHaveBeenCalled();
});
