import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import {
  commissionAmountCents,
  commissionableGross,
  normalizeAffiliateCode,
  paymentFollowsCallAttribution,
  proportionalRefund,
  reconcileAffiliateInvoice,
} from './program';

describe('affiliate program', () => {
  it('does not retroactively commission payments made before call attribution', () => {
    const attribution = '2026-09-27T12:00:00.100Z';
    const second = Date.parse('2026-09-27T12:00:00Z') / 1000;
    expect(paymentFollowsCallAttribution(second - 3600, attribution)).toBe(
      false
    );
    expect(paymentFollowsCallAttribution(second, attribution)).toBe(false);
    expect(paymentFollowsCallAttribution(second + 1, attribution)).toBe(true);
    expect(
      paymentFollowsCallAttribution(second + 30 * 86400, attribution)
    ).toBe(true);
    expect(paymentFollowsCallAttribution(second, 'invalid')).toBe(false);
  });
  it('calculates the recurring 35% in integer cents', () => {
    expect(commissionAmountCents(10_000)).toBe(3_500);
    expect(commissionAmountCents(2_999)).toBe(1_050);
  });

  it('rejects invalid monetary and rate inputs', () => {
    expect(commissionAmountCents(0)).toBe(0);
    expect(commissionAmountCents(-100)).toBe(0);
    expect(commissionAmountCents(100, 10_001)).toBe(0);
  });

  it('normalizes only the public eight-character code format', () => {
    expect(normalizeAffiliateCode(' ab12cd34 ')).toBe('AB12CD34');
    expect(normalizeAffiliateCode('short')).toBeNull();
    expect(normalizeAffiliateCode('AB12-CD3')).toBeNull();
  });

  it('does not pay commission on tax even when a discounted invoice includes tax', () => {
    const invoice = {
      billing_reason: 'subscription_cycle',
      amount_paid: 8800,
      subtotal: 10000,
      total: 8800,
      total_excluding_tax: 8000,
    } as Stripe.Invoice;
    expect(commissionableGross(invoice)).toBe(8000);
    expect(commissionAmountCents(commissionableGross(invoice))).toBe(2800);
  });

  it('excludes unpaid amounts and non-subscription invoices', () => {
    expect(
      commissionableGross({
        billing_reason: 'subscription_cycle',
        amount_paid: 0,
        total_excluding_tax: 10000,
      } as Stripe.Invoice)
    ).toBe(0);
    expect(
      commissionableGross({
        billing_reason: 'manual',
        amount_paid: 10000,
        total_excluding_tax: 10000,
      } as Stripe.Invoice)
    ).toBe(0);
  });

  it('apportions partial refunds excluding tax and caps full refunds at the original base', () => {
    expect(proportionalRefund(10000, 11000, 5500)).toBe(5000);
    expect(proportionalRefund(10000, 11000, 11000)).toBe(10000);
    expect(proportionalRefund(10000, 11000, 12000)).toBe(10000);
    expect(proportionalRefund(10000, 0, 100)).toBe(0);
  });

  it('reconciles duplicate payment references and refunded credit notes only once', async () => {
    async function* items<T>(values: T[]) {
      yield* values;
    }
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'commission', gross_cents: 10000 },
        error: null,
      }),
    };
    const db = {
      from: vi.fn().mockReturnValue(query),
      rpc,
    } as unknown as SupabaseClient;
    const stripe = {
      invoices: {
        retrieve: vi
          .fn()
          .mockResolvedValue({ amount_paid: 11000, status: 'paid' }),
      },
      invoicePayments: {
        list: () =>
          items([
            { payment: { payment_intent: 'pi_1' } },
            { payment: { payment_intent: 'pi_1' } },
          ]),
      },
      charges: { list: () => items([{ id: 'ch_1', amount_refunded: 5500 }]) },
      creditNotes: {
        list: () =>
          items([
            {
              status: 'issued',
              type: 'post_payment',
              post_payment_amount: 5500,
              refunds: [{ amount_refunded: 5500 }],
            },
            {
              status: 'void',
              type: 'post_payment',
              post_payment_amount: 5500,
              refunds: [],
            },
          ]),
      },
    } as unknown as Stripe;
    await reconcileAffiliateInvoice(db, stripe, 'in_1');
    await reconcileAffiliateInvoice(db, stripe, 'in_1');
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const call of rpc.mock.calls) {
      expect(call[0]).toBe('reconcile_affiliate_commission');
      expect(call[1]).toMatchObject({
        p_invoice_id: 'in_1',
        p_refunded_cents: 5000,
      });
    }
  });
});
