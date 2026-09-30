import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan, Suscripcion } from '@/lib/billing/plan';

const h = vi.hoisted(() => ({ guard: vi.fn(), csrf: vi.fn(), audit: vi.fn(), from: vi.fn(),
  read: vi.fn(), plans: vi.fn(), sync: vi.fn(), expire: vi.fn(), upsert: vi.fn(), update: vi.fn(), invalidate: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({ from: h.from, rpc: h.rpc }) }));
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
  h.guard.mockResolvedValue({ ok: true, actor: { userId: 'admin', email: 'admin@example.com' } });
  h.csrf.mockResolvedValue(null);
  h.read.mockResolvedValue(prior);
  h.plans.mockResolvedValue(plans);
  h.upsert.mockResolvedValue({ error: null });
  h.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_billing_admin_lease' ? 'lease' : null, error: null }));
  const query = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: before, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  query.eq.mockReturnValue(query);
  h.update.mockReturnValue(query);
  h.from.mockReturnValue({ select: () => query, upsert: h.upsert, update: h.update });
});

describe('admin merchant agreement changes', () => {
  it.each(['oficial','saldo','byok'].flatMap(from => ['oficial','saldo','byok'].map(to => ({ from, to }))))
    ('synchronizes every mode transition $from → $to', async ({ from, to }) => {
      const sourcePlan=plans.find(p => p.id === (from === 'oficial' ? 'contacts' : from))!;
      const destination=plans.find(p => p.id === (to === 'oficial' ? 'contacts' : to))!;
      const source={ ...prior, plan: sourcePlan, modeloCobro: from as Suscripcion['modeloCobro'] };
      h.read.mockResolvedValue(source);
      expect((await PUT(request({ modelo_cobro: to, plan_id: destination.id, precio_centavos_override: 25000 }))).status).toBe(200);
      expect(h.sync).toHaveBeenCalledWith(source,25000,'usd',to,{planId:destination.id,planName:destination.nombre},to==='saldo');
      expect(h.from.mock.calls.every(([table]) => table!=='workspace_billing_invoices')).toBe(true);
    });
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
    expect(h.sync.mock.invocationCallOrder[0]).toBeLessThan(h.upsert.mock.invocationCallOrder[0]);
  });
  it.each([{ plan_id: null }, { modelo_cobro: 'byok', plan_id: 'contacts' },
    { precio_centavos_override: -1 }, { precio_centavos_override: 1.2 }, { incluidas_override: 0 }])
    ('rejects invalid agreements without writes: %j', async body => {
      expect((await PUT(request(body))).status).toBe(400);
      expect(h.upsert).not.toHaveBeenCalled();
      expect(h.sync).not.toHaveBeenCalled();
    });
  it('does not change the local agreement if Stripe rejects the change', async () => {
    h.read.mockResolvedValueOnce(prior).mockResolvedValue({ ...prior, precioCentavos: 25000, precioAcuerdoCentavos: 25000 });
    h.sync.mockRejectedValue(new Error('Stripe unavailable'));
    expect((await PUT(request({ precio_centavos_override: 25000 }))).status).toBe(502);
    expect(h.upsert).not.toHaveBeenCalled();
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
  it('uses the new plan price when no account override is present', async () => {
    const next={...contact,id:'larger',slug:'contactos-2000',incluidas:2000,precioCentavos:49900};
    h.plans.mockResolvedValue([...plans,next]);
    expect((await PUT(request({ plan_id: next.id }))).status).toBe(200);
    expect(h.sync).toHaveBeenCalledWith(prior,49900,'usd','oficial',{planId:next.id,planName:next.nombre},false);
  });
  it('rejects zero-price active subscriptions before changing local or external terms', async () => {
    expect((await PUT(request({ precio_centavos_override: 0 }))).status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.sync).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenLastCalledWith('release_billing_admin_lease', { p_workspace: 'w', p_lease: 'lease' });
  });
  it('rejects overlapping agreement transitions without writes', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect((await PUT(request({ precio_centavos_override: 25000 }))).status).toBe(409);
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it('updates grace independently of Shopify pricing approval', async () => {
    h.rpc.mockResolvedValue({ data: { graceHours: 72 }, error: null });
    const response = await PUT(new Request('https://admin.riverz.co/api/admin/billing', { method: 'PUT',
      body: JSON.stringify({ gracia: { workspace_id: 'w', horas: 72, horas_previas: 24 } }) }));
    expect(response.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith('admin_set_billing_grace', { p_workspace: 'w', p_hours: 72, p_expected: 24, p_actor: 'admin', p_actor_email: 'admin@example.com' });
    expect(h.sync).not.toHaveBeenCalled(); expect(h.upsert).not.toHaveBeenCalled();
  });
  it.each([0,23,24.5,721,'72'])('rejects invalid grace %s', async horas => {
    expect((await PUT(new Request('https://admin.riverz.co/api/admin/billing', { method: 'PUT',
      body: JSON.stringify({ gracia: { workspace_id: 'w', horas, horas_previas: 24 } }) }))).status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('deducts credit using an audited idempotent adjustment instead of a bonus', async () => {
    h.rpc.mockResolvedValue({ data: [{ saldo_centavos: 1000 }], error: null });
    const id = '00000000-0000-4000-8000-000000000001';
    const response = await PUT(new Request('https://admin.riverz.co/api/admin/billing', { method: 'PUT',
      body: JSON.stringify({ saldo: { workspace_id: 'w', centavos: -100, motivo: 'Corrección', operation_id: id } }) }));
    expect(response.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith('admin_adjust_wallet', { p_workspace: 'w', p_centavos: -100,
      p_operation: id, p_kind: 'ajuste', p_reason: 'Corrección', p_actor: 'admin', p_actor_email: 'admin@example.com' });
  });
  it.each([{ centavos: -100 }, { centavos: 1.5 }, { centavos: '100' }, { centavos: 0 }, { centavos: 100000001 }])
    ('rejects unsafe adjustments: %j', async saldo => {
      expect((await PUT(new Request('https://admin.riverz.co/api/admin/billing', { method: 'PUT', body: JSON.stringify({
        saldo: { workspace_id: 'w', operation_id: '00000000-0000-4000-8000-000000000001', ...saldo },
      }) }))).status).toBe(400);
      expect(h.rpc).not.toHaveBeenCalled();
    });
});
