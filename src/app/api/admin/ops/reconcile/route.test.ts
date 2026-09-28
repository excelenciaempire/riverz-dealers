import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ csrf: vi.fn(), gate: vi.fn(), rate: vi.fn(), reconcile: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: mocks.csrf }));
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: mocks.gate }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: mocks.audit }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: mocks.rate, rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock('@/lib/channels/mercadolibre/shipment-recovery', () => ({ reconcileCapturedShipments: mocks.reconcile }));
import { POST } from './route';
const request = (body: object = {}) => new Request('https://admin.test/api/admin/ops/reconcile', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.csrf.mockResolvedValue(null);
  mocks.gate.mockResolvedValue({ ok: true, actor: { email: 'admin@test', userId: 'admin' } });
  mocks.rate.mockResolvedValue({ success: true }); mocks.reconcile.mockResolvedValue({ checked: 1, recovered: 0 });
});
it('requires CSRF before invoking recovery', async () => {
  mocks.csrf.mockResolvedValue(new Response(null, { status: 403 }));
  expect((await POST(request())).status).toBe(403); expect(mocks.reconcile).not.toHaveBeenCalled();
});
it('requires platform admin access', async () => {
  mocks.gate.mockResolvedValue({ ok: false, res: new Response(null, { status: 403 }) });
  expect((await POST(request())).status).toBe(403); expect(mocks.reconcile).not.toHaveBeenCalled();
});
it('defaults to preview and ignores arbitrary limits and resources', async () => {
  expect((await POST(request({ limit: 9999, url: 'https://untrusted.test' }))).status).toBe(200);
  expect(mocks.reconcile).toHaveBeenCalledWith({ apply: false, limit: 10 });
});
it('requires explicit apply=true and audits the bounded operation', async () => {
  await POST(request({ apply: true }));
  expect(mocks.reconcile).toHaveBeenCalledWith({ apply: true, limit: 10 }); expect(mocks.audit).toHaveBeenCalled();
});
