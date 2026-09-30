import { beforeEach, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const h = vi.hoisted(() => ({ csrf: vi.fn(), guard: vi.fn(), rate: vi.fn(), settle: vi.fn(), rpc: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: h.csrf }));
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: h.guard }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: h.audit }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ rpc: h.rpc }) }));
vi.mock('@/lib/billing/stripe', () => ({ stripe: () => ({}) }));
vi.mock('@/lib/billing/settle-invoice', async original => ({ ...await original<typeof import('@/lib/billing/settle-invoice')>(), settleSubscriptionInvoice: h.settle }));
vi.mock('@/lib/i18n/server', () => ({ getT: async () => (key: string) => key }));
vi.mock('@/lib/rate-limit', () => ({ limitByKey: h.rate, rateLimitResponse: () => NextResponse.json({}, { status: 429 }) }));
import { POST } from './route';
const body = { workspace_id: '522a68ae-568d-4dd9-92e5-2c8f633f1761', invoice_id: 'in_test', amount_remaining: 9900, currency: 'usd', method: 'agreement', reason: 'Owner agreement' };
const request = (value: unknown = body) => new Request('https://admin.riverz.co/api/admin/billing/settle', { method: 'POST', body: JSON.stringify(value) });
beforeEach(() => {
  vi.resetAllMocks(); h.csrf.mockResolvedValue(null); h.guard.mockResolvedValue({ ok: true, actor: { userId: 'admin', email: 'admin@example.com' } });
  h.rate.mockResolvedValue({ success: true }); h.rpc.mockResolvedValue({ data: 'lease', error: null });
  h.settle.mockResolvedValue({ invoiceId: 'in_test', status: 'paid', amountRemaining: 0 });
});
it('requires CSRF and admin authentication before touching invoices', async () => {
  h.csrf.mockResolvedValueOnce(NextResponse.json({}, { status: 403 })); expect((await POST(request())).status).toBe(403);
  h.guard.mockResolvedValueOnce({ ok: false, res: NextResponse.json({}, { status: 403 }) }); expect((await POST(request())).status).toBe(403);
  expect(h.settle).not.toHaveBeenCalled(); expect(h.rpc).not.toHaveBeenCalled();
});
it('validates and rate-limits requests', async () => {
  expect((await POST(request({ ...body, reason: '' }))).status).toBe(400);
  h.rate.mockResolvedValueOnce({ success: false }); expect((await POST(request())).status).toBe(429);
  expect(h.settle).not.toHaveBeenCalled();
});
it('holds the account lease, settles, audits and releases', async () => {
  expect((await POST(request())).status).toBe(200);
  expect(h.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: 'update.billing_invoice_settlement', targetId: body.workspace_id }));
  expect(h.rpc).toHaveBeenLastCalledWith('release_billing_admin_lease', { p_workspace: body.workspace_id, p_lease: 'lease' });
});
it('does not write while another agreement change owns the lease', async () => {
  h.rpc.mockResolvedValueOnce({ data: null, error: null }); expect((await POST(request())).status).toBe(409);
  expect(h.settle).not.toHaveBeenCalled();
});
it('releases the lease on a failure and never reports a false success', async () => {
  h.settle.mockRejectedValue(Error('network')); expect((await POST(request())).status).toBe(502);
  expect(h.rpc).toHaveBeenLastCalledWith('release_billing_admin_lease', expect.anything()); expect(h.audit).not.toHaveBeenCalled();
});
