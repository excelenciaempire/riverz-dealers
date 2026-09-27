import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan, Suscripcion } from '@/lib/billing/plan';

const h = vi.hoisted(() => ({ guard: vi.fn(), csrf: vi.fn(), audit: vi.fn(), from: vi.fn(),
  read: vi.fn(), plans: vi.fn(), sync: vi.fn(), expire: vi.fn(), upsert: vi.fn(), update: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: h.from }) }));
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: h.guard }));
vi.mock('@/lib/csrf', () => ({ csrfGuard: h.csrf }));
vi.mock('@/lib/admin/audit', () => ({ recordAdminAction: h.audit }));
vi.mock('@/lib/admin/route', () => ({ adminGet: vi.fn(), rangeFromSearch: vi.fn() }));
vi.mock('@/lib/billing/negocio', () => ({ leerNegocio: vi.fn() }));
vi.mock('@/lib/wallet/tarifas', () => ({ listarTarifas: vi.fn() }));
vi.mock('@/lib/billing/stripe', () => ({ sincronizarPrecioSuscripcion: h.sync, expirarCheckoutsDelAcuerdo: h.expire }));
vi.mock('@/lib/ai/platform-key', () => ({ invalidatePlatformKeyCache: h.invalidate }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }));
vi.mock('@/lib/billing/plan', async original => ({ ...await original<typeof import('@/lib/billing/plan')>(),
  leerSuscripcion: h.read, listarPlanes: h.plans }));
import { PUT } from './route';

const contact: Plan = { id: 'contacts', slug: 'contactos-500', nombre: 'Contactos', activo: true,
  precioCentavos: 19900, moneda: 'usd', incluidas: 500, excedenteCentavos: 0,
  stripePriceId: null, stripePriceExcedenteId: null, orden: 1 };
const plans = [contact, { ...contact, id: 'saldo', slug: 'saldo-ilimitado', incluidas: 0 },
  { ...contact, id: 'byok', slug: 'byok', incluidas: 0 }];
const prior: Suscripcion = { workspaceId: 'w', plan: contact, estado: 'activa', pruebaHasta: null,
  periodoDesde: null, periodoHasta: null, vencidaDesde: null, nota: null,
  stripeCustomerId: 'cus', stripeSubscriptionId: 'sub', billingProvider: 'stripe',
  shopifySubscriptionId: null, shopifyShopDomain: null, cancelarAlFinal: false,
  modeloCobro: 'oficial', precioCentavos: 19900, precioAcuerdoCentavos: 19900,
  incluidas: 500, excedenteCentavos: 0, tratoPropio: false };
const before = { plan_id: 'contacts', modelo_cobro: 'oficial', precio_centavos_override: null };
const request = (cuenta: object) => new Request('https://admin.riverz.co/api/admin/billing', {
  method: 'PUT', body: JSON.stringify({ cuenta: { workspace_id: 'w', ...cuenta } }) });

beforeEach(() => {
  vi.resetAllMocks();
  h.guard.mockResolvedValue({ ok: true, actor: { userId: 'admin' } });
  h.csrf.mockResolvedValue(null);
  h.read.mockResolvedValue(prior);
  h.plans.mockResolvedValue(plans);
  h.upsert.mockResolvedValue({ error: null });
  const query = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: before, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  query.eq.mockReturnValue(query);
  h.update.mockReturnValue(query);
  h.from.mockReturnValue({ select: () => query, upsert: h.upsert, update: h.update });
});

describe('admin merchant agreement changes', () => {
  it.each(['oficial', 'saldo', 'byok'] as const)('syncs %s with Stripe and audits before/after', async model => {
    const plan = plans.find(p => p.id === (model === 'oficial' ? 'contacts' : model))!;
    h.read.mockResolvedValueOnce(prior).mockResolvedValue({ ...prior, plan, modeloCobro: model,
      precioCentavos: 25000, precioAcuerdoCentavos: 25000 });
    expect((await PUT(request({ modelo_cobro: model, plan_id: plan.id, precio_centavos_override: 25000 }))).status).toBe(200);
    expect(h.sync).toHaveBeenCalledWith(prior, 25000, 'usd', model,
      { planId: plan.id, planName: plan.nombre }, model === 'saldo');
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      targetId: 'w', meta: { before, after: expect.objectContaining({ modelo_cobro: model }) },
    }));
    if (model !== 'saldo') expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ auto_recarga_centavos: null }));
  });
  it.each([{ plan_id: null }, { modelo_cobro: 'byok', plan_id: 'contacts' },
    { precio_centavos_override: -1 }, { precio_centavos_override: 1.2 }, { incluidas_override: 0 }])
    ('rejects invalid agreements without writes: %j', async body => {
      expect((await PUT(request(body))).status).toBe(400);
      expect(h.upsert).not.toHaveBeenCalled();
      expect(h.sync).not.toHaveBeenCalled();
    });
  it('restores the agreement if Stripe rejects the change', async () => {
    h.read.mockResolvedValueOnce(prior).mockResolvedValue({ ...prior, precioCentavos: 25000, precioAcuerdoCentavos: 25000 });
    h.sync.mockRejectedValue(new Error('Stripe unavailable'));
    expect((await PUT(request({ precio_centavos_override: 25000 }))).status).toBe(502);
    expect(h.update).toHaveBeenCalledWith(before);
    expect(h.audit).not.toHaveBeenCalled();
  });
  it('does not silently replace an active Shopify agreement', async () => {
    h.read.mockResolvedValue({ ...prior, billingProvider: 'shopify', shopifySubscriptionId: 'gid://shopify/AppSubscription/1' });
    expect((await PUT(request({ modelo_cobro: 'saldo', plan_id: 'saldo' }))).status).toBe(409);
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it('requires admin access', async () => {
    h.guard.mockResolvedValue({ ok: false, res: new Response(null, { status: 403 }) });
    expect((await PUT(request({ modelo_cobro: 'oficial' }))).status).toBe(403);
    expect(h.from).not.toHaveBeenCalled();
  });
  it('invalidates unpaid old links before changing their agreement', async () => {
    h.read.mockResolvedValue({ ...prior, estado: 'cortesia', stripeSubscriptionId: null });
    expect((await PUT(request({ precio_centavos_override: 25000 }))).status).toBe(200);
    expect(h.expire).toHaveBeenCalled();
    expect(h.expire.mock.invocationCallOrder[0]).toBeLessThan(h.upsert.mock.invocationCallOrder[0]);
  });
  it('does not change the agreement when old checkout expiration fails', async () => {
    h.read.mockResolvedValue({ ...prior, estado: 'cortesia', stripeSubscriptionId: null });
    h.expire.mockRejectedValue(new Error('Stripe unavailable'));
    expect((await PUT(request({ precio_centavos_override: 25000 }))).status).toBe(502);
    expect(h.upsert).not.toHaveBeenCalled();
  });
});
