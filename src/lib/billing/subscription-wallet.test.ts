import { expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareSubscriptionWallet } from './subscription-wallet';
function fixture(model = 'saldo') {
  const writes: Array<{
    table: string;
    values: Record<string, unknown>;
    options?: unknown;
  }> = [];
  const db = {
    from: (table: string) => ({
      upsert: async (values: Record<string, unknown>, options: unknown) => {
        writes.push({ table, values, options });
        return { error: null };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { modelo_cobro: model },
            error: null,
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          writes.push({ table, values });
          return { error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  const retrieve = vi
    .fn()
    .mockResolvedValue({
      id: 'pm-1',
      customer: 'cus-1',
      card: { brand: 'visa', last4: '4242' },
    });
  const api = {
    paymentMethods: { retrieve },
    customers: { retrieve: vi.fn() },
  } as unknown as Stripe;
  const sub = {
    customer: 'cus-1',
    default_payment_method: 'pm-1',
  } as Stripe.Subscription;
  return { db, api, sub, writes, retrieve };
}
it('saves the subscription card without adding balance, changing limits, or enabling auto-charge', async () => {
  const f = fixture();
  await prepareSubscriptionWallet(f.db, f.api, 'ws-1', f.sub);
  expect(f.writes[0]).toMatchObject({
    values: { workspace_id: 'ws-1' },
    options: { ignoreDuplicates: true },
  });
  expect(f.writes[1].values).toMatchObject({
    stripe_payment_method_id: 'pm-1',
    tarjeta_marca: 'visa',
    tarjeta_ultimos4: '4242',
  });
  for (const w of f.writes)
    for (const key of [
      'saldo_centavos',
      'auto_recarga_centavos',
      'bloquear_sin_saldo',
      'modelo_cobro',
    ])
      expect(w.values).not.toHaveProperty(key);
});
it.each(['oficial', 'byok'])(
  'does not add wallet card UI to the %s model',
  async (model) => {
    const f = fixture(model);
    await prepareSubscriptionWallet(f.db, f.api, 'ws-1', f.sub);
    expect(f.retrieve).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(1);
  }
);
it('rejects a payment method belonging to another customer', async () => {
  const f = fixture();
  f.retrieve.mockResolvedValue({ id: 'pm-1', customer: 'cus-other' });
  await expect(
    prepareSubscriptionWallet(f.db, f.api, 'ws-1', f.sub)
  ).rejects.toThrow('customer_mismatch');
  expect(f.writes).toHaveLength(1);
});
