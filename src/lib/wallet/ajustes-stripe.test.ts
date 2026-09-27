import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ajustarRecargaDesdeEvento } from './ajustes-stripe';
import { COMISION_REAL } from './comision';
const mocks = vi.hoisted(() => ({
  charge: vi.fn(),
  payment: vi.fn(),
  mover: vi.fn(),
}));
vi.mock('@/lib/billing/stripe', () => ({
  stripe: () => ({
    charges: { retrieve: mocks.charge },
    paymentIntents: { retrieve: mocks.payment },
  }),
}));
vi.mock('./saldo', () => ({ mover: mocks.mover }));
const query = {
  select: () => query,
  eq: () => query,
  maybeSingle: async () => ({ data: { id: 'credited' }, error: null }),
};
const db = { from: () => query } as unknown as SupabaseClient;
const event = (type: string, object: unknown) =>
  ({ id: 'evt', type, data: { object } }) as Stripe.Event;
beforeEach(() => {
  mocks.charge.mockResolvedValue({ payment_intent: 'pi' });
  mocks.payment.mockResolvedValue({
    metadata: {
      tipo: 'recarga_billetera',
      workspace_id: 'ws',
      comision: COMISION_REAL,
    },
  });
});
describe('top-up refund and dispute accounting', () => {
  it('adjusts only principal, leaving processing fees to Riverz', async () => {
    await ajustarRecargaDesdeEvento(
      db,
      event('refund.updated', {
        charge: 'ch',
        balance_transaction: { id: 'tx', currency: 'usd', net: -503, amount: -500, fee: 3 },
      })
    );
    expect(mocks.mover).toHaveBeenCalledWith(
      db,
      'ws',
      expect.objectContaining({ centavos: -500, stripeId: 'wallet:tx' })
    );
  });
  it('applies the withdrawal and reinstatement with their own actual fees', async () => {
    const txs = [
      { id: 'withdrawn', currency: 'usd', net: -2500, amount: -1000, fee: 1500 },
      { id: 'returned', currency: 'usd', net: 1000, amount: 1000, fee: 0 },
    ];
    await ajustarRecargaDesdeEvento(
      db,
      event('charge.dispute.funds_reinstated', {
        charge: 'ch',
        balance_transactions: txs,
      })
    );
    expect(
      mocks.mover.mock.calls.map((c) => [c[2].stripeId, c[2].centavos])
    ).toEqual([
      ['wallet:withdrawn', -1000],
      ['wallet:returned', 1000],
    ]);
  });
  it('asks for a webhook retry when the receipt is still unavailable', async () => {
    await expect(
      ajustarRecargaDesdeEvento(
        db,
        event('refund.created', { charge: 'ch', balance_transaction: null })
      )
    ).rejects.toThrow('wallet_adjustment_pending');
    expect(mocks.mover).not.toHaveBeenCalled();
  });
  it('does not allocate subscription refunds to prepaid balance', async () => {
    mocks.payment.mockResolvedValue({ metadata: { tipo: 'subscription' } });
    expect(
      await ajustarRecargaDesdeEvento(
        db,
        event('refund.updated', { charge: 'ch' })
      )
    ).toBeNull();
    expect(mocks.mover).not.toHaveBeenCalled();
  });
});
