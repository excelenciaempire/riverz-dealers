import { beforeEach, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
const m = vi.hoisted(() => ({ retrieve: vi.fn(), wallet: vi.fn() }));
vi.mock('stripe', () => ({
  default: class {
    subscriptions = { retrieve: m.retrieve };
  },
}));
vi.mock('./subscription-wallet', () => ({
  prepareSubscriptionWallet: m.wallet,
}));
vi.mock('@/lib/avisos/destinos', () => ({
  destinosDeAviso: async () => [],
  avisarATodos: async () => ({ ok: true, enviados: 0 }),
}));
vi.mock('@/lib/admin/correo', () => ({ enviarCorreo: async () => false }));
vi.mock('@/lib/i18n/cuenta', () => ({ localeDeCuenta: async () => 'es' }));
import { aplicarEvento } from './stripe';
function fixture(status = 'trialing') {
  const writes: Record<string, unknown>[] = [];
  const previous: { estado: string; stripe_subscription_id?: string; stripe_customer_id?: string } = { estado: 'activa' };
  const query = {
    eq: () => query,
    maybeSingle: async () => ({ data: previous, error: null }),
  };
  const db = {
    from: () => ({
      select: () => query,
      upsert: async (values: Record<string, unknown>) => {
        writes.push(values);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  const sub = {
    id: 'sub-1',
    customer: 'cus-1',
    metadata: { workspace_id: 'ws-1' },
    status,
    items: { data: [{ current_period_start: 1000, current_period_end: 2000 }] },
  };
  const event = {
    type: 'checkout.session.completed',
    data: {
      object: {
        mode: 'subscription',
        status: 'complete',
        subscription: 'sub-1',
        customer: 'cus-1',
        metadata: { workspace_id: 'ws-1' },
        payment_status: 'no_payment_required',
      },
    },
  } as unknown as Stripe.Event;
  m.retrieve.mockResolvedValue(sub);
  return { db, writes, event, sub, previous };
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  m.wallet.mockResolvedValue(undefined);
});
it.each([9900, 39900])(
  'tracks the %s-cent agreed price when a managed pilot schedule advances',
  async (amount) => {
    const f = fixture('active');
    Object.assign(f.sub.metadata, {
      billing_agreement: 'scheduled_fixed_price',
    });
    Object.assign(f.sub, { discounts: [] });
    Object.assign(f.sub.items.data[0], {
      price: {
        unit_amount: amount,
        currency: 'usd',
        recurring: { interval: 'month' },
      },
    });
    await aplicarEvento(f.db, f.event);
    expect(f.writes[0]).toMatchObject({ precio_centavos_override: amount });
  }
);
it('preserves an ordinary negotiated price without a managed schedule marker', async () => {
  const f = fixture('active');
  Object.assign(f.sub.items.data[0], {
    price: {
      unit_amount: 39900,
      currency: 'usd',
      recurring: { interval: 'month' },
    },
  });
  await aplicarEvento(f.db, f.event);
  expect(f.writes[0]).not.toHaveProperty('precio_centavos_override');
});
it.each(['trialing', 'active'])(
  'activates a verified %s subscription from the completed admin checkout',
  async (status) => {
    const f = fixture(status);
    await aplicarEvento(f.db, f.event);
    expect(m.wallet).toHaveBeenCalledOnce();
    expect(f.writes[0]).toMatchObject({
      workspace_id: 'ws-1',
      estado: 'activa',
      stripe_subscription_id: 'sub-1',
    });
    expect(f.writes[0]).not.toHaveProperty('modelo_cobro');
  }
);
it('does not grant active access for an incomplete payment', async () => {
  const f = fixture('incomplete');
  await aplicarEvento(f.db, f.event);
  expect(f.writes[0].estado).toBe('vencida');
  expect(m.wallet).not.toHaveBeenCalled();
});
it('ignores deletion of an older subscription after a merchant renewed with a replacement', async () => {
  const f = fixture('canceled');
  f.previous.stripe_subscription_id = 'sub-new';
  const event = { type: 'customer.subscription.deleted', data: { object: f.sub } } as unknown as Stripe.Event;
  expect(await aplicarEvento(f.db,event)).toContain('ignorado');
  expect(f.writes).toHaveLength(0); expect(m.wallet).not.toHaveBeenCalled();
});
it('reconciles provider-confirmed admin mode and price after a local write interruption', async () => {
  const f = fixture('active');
  Object.assign(f.sub.metadata, { billing_agreement: 'admin_fixed_price', modelo_cobro: 'byok' });
  Object.assign(f.sub.items.data[0], { price: { unit_amount: 9900, currency: 'usd', recurring: { interval: 'month' } } });
  await aplicarEvento(f.db, f.event);
  expect(f.writes[0]).toMatchObject({ modelo_cobro: 'byok', precio_centavos_override: 9900 });
});
it('rejects a checkout for another customer', async () => {
  const f = fixture();
  (f.event.data.object as Stripe.Checkout.Session).customer = 'cus-other';
  await expect(aplicarEvento(f.db, f.event)).rejects.toThrow(
    'account_mismatch'
  );
  expect(f.writes).toEqual([]);
});
it('ignores a mere open checkout or an unrelated card setup', async () => {
  const f = fixture();
  (f.event.data.object as Stripe.Checkout.Session).status = 'open';
  await aplicarEvento(f.db, f.event);
  expect(m.retrieve).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
  (f.event.data.object as Stripe.Checkout.Session).status = 'complete';
  (f.event.data.object as Stripe.Checkout.Session).mode = 'setup';
  await aplicarEvento(f.db, f.event);
  expect(f.writes).toEqual([]);
});
it('fails for webhook retry before publishing activation when wallet preparation fails', async () => {
  const f = fixture();
  m.wallet.mockRejectedValue(new Error('database_unavailable'));
  await expect(aplicarEvento(f.db, f.event)).rejects.toThrow(
    'database_unavailable'
  );
  expect(f.writes).toEqual([]);
});

it('uses current Stripe state rather than a delayed subscription update', async () => {
  const f = fixture('active');
  const delayed = {
    type: 'customer.subscription.updated',
    data: { object: { ...f.sub, status: 'past_due' } },
  } as unknown as Stripe.Event;
  await aplicarEvento(f.db, delayed);
  expect(m.retrieve).toHaveBeenCalledWith('sub-1');
  expect(f.writes[0]).toMatchObject({ estado: 'activa', vencida_desde: null });
});
