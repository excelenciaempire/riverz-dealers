import { beforeEach, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { settleSubscriptionInvoice, validInvoiceSettlement } from './settle-invoice';

const input = { workspace_id: '522a68ae-568d-4dd9-92e5-2c8f633f1761', invoice_id: 'in_test',
  amount_remaining: 9900, currency: 'usd', method: 'agreement' as const, reason: 'Owner agreement for September' };
const actor = { userId: 'admin', email: 'admin@example.com' };
let invoice: Record<string, unknown>, account: Record<string, unknown>;
const h = { retrieve: vi.fn(), credit: vi.fn(), pay: vi.fn(), invoiceUpdate: vi.fn(), subscription: vi.fn(),
  from: vi.fn(), update: vi.fn(), rpc: vi.fn() };
const client = { invoices: { retrieve: h.retrieve, pay: h.pay, update: h.invoiceUpdate },
  creditNotes: { create: h.credit }, subscriptions: { retrieve: h.subscription } } as unknown as Stripe;
const db = { from: h.from, rpc: h.rpc } as unknown as SupabaseClient;
beforeEach(() => {
  vi.resetAllMocks();
  invoice = { id: 'in_test', status: 'open', amount_remaining: 9900, currency: 'usd', customer: 'cus_test',
    metadata: { kind: 'riverz_subscription_correction', subscription_id: 'sub_test', workspace_id: input.workspace_id },
    status_transitions: { finalized_at: 1780000000 }, created: 1780000000, collection_method: 'charge_automatically' };
  account = { workspace_id: input.workspace_id, stripe_customer_id: 'cus_test', stripe_subscription_id: 'sub_test' };
  h.retrieve.mockImplementation(async () => ({ ...invoice }));
  h.credit.mockImplementation(async () => { invoice.status = 'paid'; invoice.amount_remaining = 0; return { id: 'cn_test' }; });
  h.pay.mockImplementation(async () => { invoice.status = 'paid'; invoice.amount_remaining = 0; return invoice; });
  h.subscription.mockResolvedValue({ id: 'sub_test', status: 'active' });
  const q = { eq: vi.fn(), maybeSingle: vi.fn().mockImplementation(async () => ({ data: account, error: null })),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  q.eq.mockReturnValue(q); h.update.mockReturnValue(q);
  h.from.mockReturnValue({ select: () => q, update: h.update });
  h.rpc.mockResolvedValue({ error: null });
});
it('waives exactly the unpaid invoice through a credit note, with no card charge or next-month credit', async () => {
  expect(await settleSubscriptionInvoice(db, client, input, actor)).toMatchObject({ status: 'paid', amountRemaining: 0 });
  expect(h.credit).toHaveBeenCalledWith(expect.objectContaining({ invoice: 'in_test', amount: 9900, email_type: 'none',
    metadata: expect.objectContaining({ riverz_settlement_method: 'agreement', riverz_settlement_actor: 'admin' }) }),
    { idempotencyKey: 'riverz-admin-settle-in_test-agreement-v1' });
  const params = h.credit.mock.calls[0][0];
  expect(params).not.toHaveProperty('credit_amount'); expect(params).not.toHaveProperty('refund_amount');
  expect(h.pay).not.toHaveBeenCalled(); expect(h.invoiceUpdate).not.toHaveBeenCalled();
  expect(h.update.mock.calls[0][0]).toMatchObject({ estado: 'activa', vencida_desde: null });
  expect(Object.keys(h.update.mock.calls[0][0]).sort()).toEqual(['estado', 'updated_at', 'vencida_desde']);
  expect(h.from.mock.calls.every(([table]) => table === 'workspace_subscriptions')).toBe(true);
  expect(h.rpc).toHaveBeenCalledWith('record_subscription_invoice', { p_invoice: expect.objectContaining({ status: 'paid', amount_remaining: 0 }) });
});
it('records an external payment without charging the saved payment method', async () => {
  await settleSubscriptionInvoice(db, client, { ...input, method: 'external_payment' }, actor);
  expect(h.pay).toHaveBeenCalledWith('in_test', { paid_out_of_band: true }, expect.anything());
  expect(h.credit).not.toHaveBeenCalled();
});
it('is safe to retry after Stripe settled but the first response or database write was lost', async () => {
  h.rpc.mockResolvedValueOnce({ error: { message: 'database unavailable' } });
  await expect(settleSubscriptionInvoice(db, client, input, actor)).rejects.toThrow('persistence_failed');
  expect(await settleSubscriptionInvoice(db, client, input, actor)).toMatchObject({ alreadySettled: true });
  expect(h.credit).toHaveBeenCalledTimes(1);
});
it.each(['customer', 'subscription', 'workspace', 'kind'])('rejects an unrelated %s before financial writes', async field => {
  if (field === 'customer') invoice.customer = 'cus_other';
  else invoice.metadata = { ...(invoice.metadata as object), [field === 'subscription' ? 'subscription_id' : field === 'workspace' ? 'workspace_id' : 'kind']: 'other' };
  await expect(settleSubscriptionInvoice(db, client, input, actor)).rejects.toThrow('mismatch');
  expect(h.credit).not.toHaveBeenCalled(); expect(h.pay).not.toHaveBeenCalled();
});
it.each([{ amount_remaining: 100 }, { currency: 'eur' }, { status: 'void' }, { status: 'uncollectible' }])('rejects a changed invoice %j', async changes => {
  Object.assign(invoice, changes);
  await expect(settleSubscriptionInvoice(db, client, input, actor)).rejects.toThrow('changed');
  expect(h.credit).not.toHaveBeenCalled(); expect(h.pay).not.toHaveBeenCalled();
});
it('does not invent active subscription status while Stripe still reports past_due', async () => {
  h.subscription.mockResolvedValue({ id: 'sub_test', status: 'past_due' });
  await settleSubscriptionInvoice(db, client, input, actor);
  expect(h.update).not.toHaveBeenCalled();
});
it('does not grant access if Stripe failed to settle the invoice', async () => {
  h.credit.mockResolvedValue({ id: 'cn_pending' });
  await expect(settleSubscriptionInvoice(db, client, input, actor)).rejects.toThrow('unavailable');
  expect(h.rpc).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
});
it('validates the workspace, invoice, positive integer amount, method and required audit reason', () => {
  expect(validInvoiceSettlement(input)).toBe(true);
  for (const change of [{ workspace_id: 'other' }, { invoice_id: 'https://evil' }, { amount_remaining: 0 },
    { amount_remaining: 1.5 }, { currency: 'USD' }, { method: 'card_charge' }, { reason: '  ' }, { reason: 'x'.repeat(501) }]) {
    expect(validInvoiceSettlement({ ...input, ...change })).toBe(false);
  }
});
