import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ csrf: vi.fn(), gate: vi.fn(), rate: vi.fn(), token: vi.fn(), read: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: mocks.csrf }));
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: mocks.gate }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: mocks.audit }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: mocks.rate, rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock('@/lib/shopify/token-vivo', () => ({ COLUMNAS_TOKEN: 'id,shop_domain', tokenVivo: mocks.token }));
vi.mock('@/lib/shopify/oauth', () => ({ shopifyApiVersion: () => '2026-07' }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: mocks.read }; return q;
} }) }));
import { POST } from './route';
const id = '20ffcd71-0000-4000-8000-000000000000';
const request = (body = { id }) => new Request('https://admin.test/api/admin/ops/shopify-check', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.csrf.mockResolvedValue(null);
  mocks.gate.mockResolvedValue({ ok: true, actor: { email: 'admin@test' } });
  mocks.rate.mockResolvedValue({ success: true });
  mocks.read.mockResolvedValue({ data: { id, shop_domain: 'riverz-demo.myshopify.com' } });
  mocks.token.mockResolvedValue({ accessToken: 'private-token' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: 'Not Found' }), { status: 404 })));
});
it('requires CSRF and admin access before reading a credential', async () => {
  mocks.csrf.mockResolvedValueOnce(new Response(null, { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  mocks.gate.mockResolvedValueOnce({ ok: false, res: new Response(null, { status: 403 }) });
  expect((await POST(request())).status).toBe(403); expect(mocks.token).not.toHaveBeenCalled();
});
it('rejects arbitrary hosts without transmitting credentials', async () => {
  mocks.read.mockResolvedValue({ data: { id, shop_domain: 'attacker.test' } });
  expect((await POST(request())).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled(); expect(mocks.token).not.toHaveBeenCalled();
});
it('returns only provider status metadata and records the read-only diagnostic', async () => {
  const response = await POST(request()); const result = await response.json();
  expect(result.checks).toHaveLength(3);
  expect(result.checks.every((c: {status: number; valid: boolean}) => c.status === 404 && !c.valid)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private-token');
  expect(mocks.audit).toHaveBeenCalled();
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
});
