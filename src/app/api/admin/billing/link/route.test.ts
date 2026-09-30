import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ guard: vi.fn(), csrf: vi.fn(), checkout: vi.fn(), audit: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: h.guard }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: h.csrf }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: h.audit }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: h.from }) }));
vi.mock('@/lib/billing/plan', () => ({ aSuscripcion: (value: unknown) => value }));
vi.mock('@/lib/billing/stripe', () => ({ stripeDisponible: () => true, cuponesVigentes: vi.fn(), urlDeCheckout: h.checkout }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));
import { POST } from './route';
const request = (extra: object = {}) => new Request('https://admin.riverz.co/api/admin/billing/link', {
  method: 'POST', body: JSON.stringify({ workspace_id: 'w1', ...extra }) });
beforeEach(() => {
  vi.resetAllMocks(); h.guard.mockResolvedValue({ ok: true, actor: { userId: 'admin' } }); h.csrf.mockResolvedValue(null);
  const query = { eq: vi.fn(), maybeSingle: async () => ({ data: { workspaceId: 'w1' }, error: null }) };
  query.eq.mockReturnValue(query); h.from.mockReturnValue({ select: () => query });
  h.checkout.mockResolvedValue('https://checkout.stripe.com/c/pay/cs_test');
});
it('forwards and audits the explicit no-discount choice', async () => {
  expect((await POST(request({ primer_mes_sin_descuento: true }))).status).toBe(200);
  expect(h.checkout).toHaveBeenCalledWith(expect.anything(), 'w1', expect.anything(), expect.anything(),
    { cupon: null, primerMesSinCargo: false, primerMesSinDescuento: true });
  expect(h.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ meta: expect.objectContaining({ primerMesSinDescuento: true }) }));
});
it('keeps the default promotion, free month and custom coupons available', async () => {
  for (const extra of [{}, { primer_mes_sin_cargo: true }, { cupon: 'pilot' }]) {
    expect((await POST(request(extra))).status).toBe(200);
  }
  expect(h.checkout.mock.calls.map(call => call[4])).toEqual([
    { cupon: null, primerMesSinCargo: false, primerMesSinDescuento: false },
    { cupon: null, primerMesSinCargo: true, primerMesSinDescuento: false },
    { cupon: 'pilot', primerMesSinCargo: false, primerMesSinDescuento: false },
  ]);
});
it.each([{ primer_mes_sin_descuento: 'true' }, { primer_mes_sin_descuento: true, primer_mes_sin_cargo: true },
  { primer_mes_sin_descuento: true, cupon: 'pilot' }])('rejects contradictory first-month choices %j', async extra => {
  expect((await POST(request(extra))).status).toBe(400); expect(h.checkout).not.toHaveBeenCalled();
});
it('requires admin and CSRF before creating a link', async () => {
  const response = new Response('{}', { status: 403 });
  h.csrf.mockResolvedValueOnce(response); expect((await POST(request())).status).toBe(403);
  h.guard.mockResolvedValueOnce({ ok: false, res: response }); expect((await POST(request())).status).toBe(403);
  expect(h.checkout).not.toHaveBeenCalled();
});
