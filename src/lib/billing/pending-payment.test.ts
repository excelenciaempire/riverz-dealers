import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { pendingSubscriptionPayment, reconcileSubscriptionInvoices, safeInvoiceUrl, syncSubscriptionInvoice } from './pending-payment';

function fixture(over: Record<string, unknown> = {}) {
  const invoice = { id: 'in_1', customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } },
    metadata: {}, billing_reason: 'subscription_cycle', status: 'open', created: 100,
    status_transitions: { finalized_at: 200 }, collection_method: 'charge_automatically',
    amount_remaining: 9900, currency: 'usd', hosted_invoice_url: 'https://invoice.stripe.com/i/pay/one', ...over };
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const account = { workspace_id: 'ws_1', stripe_customer_id: 'cus_1' };
  let pending: Record<string, unknown> | null = null;
  const filters: unknown[][] = [];
  const db = { rpc, from: (table: string) => {
    const q = { select: () => q, eq: (...args: unknown[]) => { filters.push(args); return q; },
      in: (...args: unknown[]) => { filters.push(args); return q; }, gt: (...args: unknown[]) => { filters.push(args); return q; },
      lte: (...args: unknown[]) => { filters.push(args); return q; }, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: table === 'workspace_subscriptions' ? account : pending, error: null }) };
    return q;
  } } as unknown as SupabaseClient;
  const retrieve = vi.fn().mockResolvedValue(invoice);
  const client = { invoices: { retrieve } } as unknown as Stripe;
  return { db, client, rpc, invoice, retrieve, filters, account, setPending: (v: Record<string, unknown> | null) => { pending = v; } };
}

describe('monthly invoices', () => {
  it('tracks monthly renewal independently of prepaid credit, with a deterministic deadline', async () => {
    const f = fixture();
    expect(await syncSubscriptionInvoice(f.db, f.client, 'in_1')).toMatchObject({ workspaceId: 'ws_1', status: 'open' });
    expect(f.retrieve).toHaveBeenCalledWith('in_1');
    expect(f.rpc).toHaveBeenCalledWith('record_subscription_invoice', { p_invoice: expect.objectContaining({ amount_remaining: 9900,
      unpaid_since: new Date(200000).toISOString() }) });
    await syncSubscriptionInvoice(f.db, f.client, 'in_1');
    expect(f.rpc.mock.calls[0][1]).toEqual(f.rpc.mock.calls[1][1]);
  });
  it('tracks stand-alone Pilar corrections but ignores wallet and capacity invoices', async () => {
    const f = fixture({ parent: null, metadata: { kind: 'riverz_subscription_correction', subscription_id: 'sub_1', workspace_id: 'ws_1' } });
    expect(await syncSubscriptionInvoice(f.db, f.client, 'in_1')).not.toBeNull();
    for (const kind of ['riverz_capacity_upgrade', 'wallet_topup']) {
      f.invoice.metadata = { kind };
      expect(await syncSubscriptionInvoice(f.db, f.client, 'in_1')).toBeNull();
    }
  });
  it('does not reopen paid invoices from delayed failure snapshots; retrieves the actual invoice', async () => {
    const f = fixture({ status: 'paid', amount_remaining: 0 });
    await syncSubscriptionInvoice(f.db, f.client, 'in_1');
    expect(f.rpc).toHaveBeenCalledWith('record_subscription_invoice', { p_invoice: expect.objectContaining({ status: 'paid', amount_remaining: 0 }) });
  });
  it('keeps partial payment pending and honors future send-invoice due dates', async () => {
    const f = fixture({ amount_remaining: 4000, collection_method: 'send_invoice', due_date: 500 });
    await syncSubscriptionInvoice(f.db, f.client, 'in_1');
    expect(f.rpc.mock.calls[0][1].p_invoice).toMatchObject({ amount_remaining: 4000, unpaid_since: new Date(500000).toISOString() });
  });
  it('does not track draft/proration/unrelated invoices or cross-customer debt', async () => {
    for (const over of [{ status: 'draft' }, { billing_reason: 'subscription_update' }, { parent: null }]) {
      const f = fixture(over);
      expect(await syncSubscriptionInvoice(f.db, f.client, 'in_1')).toBeNull();
      expect(f.rpc).not.toHaveBeenCalled();
    }
    for (const over of [{ customer: 'cus_other' }, { metadata: { workspace_id: 'ws_other' } }]) {
      const f = fixture(over);
      await expect(syncSubscriptionInvoice(f.db, f.client, 'in_1')).rejects.toThrow('account_mismatch');
      expect(f.rpc).not.toHaveBeenCalled();
    }
  });
  it('does not acknowledge failed persistence', async () => {
    const f = fixture(); f.rpc.mockResolvedValueOnce({ error: { message: 'offline' } });
    await expect(syncSubscriptionInvoice(f.db, f.client, 'in_1')).rejects.toThrow('persistence_failed');
  });
  it('allows the first 24 hours, blocks at the exact deadline, and clears after paid reconciliation', async () => {
    const f = fixture(); const start = 1_800_000_000_000; const end = start + 86_400_000;
    f.setPending({ invoice_id: 'in_1', hosted_invoice_url: f.invoice.hosted_invoice_url, grace_until: new Date(end).toISOString() });
    expect(await pendingSubscriptionPayment(f.db, 'ws_1', start)).toMatchObject({ hours: 24, blocked: false });
    expect(await pendingSubscriptionPayment(f.db, 'ws_1', end - 1)).toMatchObject({ hours: 1, blocked: false });
    expect(await pendingSubscriptionPayment(f.db, 'ws_1', end)).toMatchObject({ hours: 0, blocked: true });
    expect(f.filters).toContainEqual(['amount_remaining', 0]); // $0 invoices never pause AI.
    expect(f.filters).toContainEqual(['workspace_id', 'ws_1']);
    f.setPending(null);
    expect(await pendingSubscriptionPayment(f.db, 'ws_1', end)).toBeNull();
  });
  it('accepts only authentic HTTPS hosted-invoice links', () => {
    for (const url of ['javascript:alert(1)', 'https://evil.test', 'https://invoice.stripe.com.evil.test', 'http://invoice.stripe.com', 'https://user:pass@invoice.stripe.com']) expect(safeInvoiceUrl(url)).toBeNull();
    expect(safeInvoiceUrl('https://invoice.stripe.com/i/pay/one')).toBe('https://invoice.stripe.com/i/pay/one');
  });
  it.each([false, true])('recovers paid invoices despite another merchant or discovery failure (%s)', async discoveryFails => {
    const f = fixture({ status: 'paid', amount_remaining: 0 });
    const pendingQuery = { select: () => ({ in: () => ({ gt: async () => ({
      data: [{ invoice_id: 'in_bad' }, { invoice_id: 'in_paid' }], error: null,
    }) }) }) };
    const db = { ...f.db, from: (table: string) => table === 'workspace_subscriptions' ? f.db.from(table) : pendingQuery } as unknown as SupabaseClient;
    f.retrieve.mockRejectedValueOnce(new Error('outage'));
    const client = { invoices: { retrieve: f.retrieve, list: () => (async function* () {
      if (discoveryFails) throw new Error('discovery unavailable');
    })() } } as unknown as Stripe;
    const refresh = vi.fn().mockResolvedValue(undefined);
    expect(await reconcileSubscriptionInvoices(db, client, refresh)).toEqual({ synced: 1,
      failures: discoveryFails ? ['list_open', 'list_uncollectible', 'in_bad'] : ['in_bad'] });
    expect(refresh).toHaveBeenCalledWith('sub_1');
  });
});
