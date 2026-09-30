import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const mocks = vi.hoisted(() => ({ markPaid: vi.fn() }));
vi.mock('@/lib/shopify/order-tags', () => ({ resolveShopifyAdmin: async () => ({}) }));
vi.mock('@/lib/shopify/mark-paid', () => ({ markOrderPaid: mocks.markPaid }));
import { decidir } from './resolve';

function fixture(expiresAt: string) {
  const row: Record<string, unknown> = { id: 'approval-1', workspace_id: 'business-1', status: 'pendiente',
    expires_at: expiresAt, kind: 'pago_informado', title: 'Payment', payload: { shopify_order_id: '123' } };
  const db = { from: (table: string) => {
    let patch: Record<string, unknown> = {};
    const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
    function resolve() {
      if (table !== 'approval_requests' || !predicates.every(fn => fn(row))) return { data: null, error: null };
      Object.assign(row, patch);
      return { data: { ...row }, error: null };
    }
    const query = {
      update: (value: Record<string, unknown>) => { patch = value; return query; },
      eq: (key: string, value: unknown) => { predicates.push(r => r[key] === value); return query; },
      gt: (key: string, value: string) => { predicates.push(r => String(r[key]) > value); return query; },
      select: () => query,
      maybeSingle: async () => resolve(),
      then: (done: (value: unknown) => unknown) => Promise.resolve(resolve()).then(done),
    };
    return query;
  } } as unknown as SupabaseClient;
  return db;
}
describe('approval execution guard', () => {
  beforeEach(() => { mocks.markPaid.mockReset().mockResolvedValue({ ok: true, financialStatus: 'paid' }); });
  it('only one of two concurrent decisions can execute the payment', async () => {
    const db = fixture(new Date(Date.now() + 60000).toISOString());
    const args = { approvalId: 'approval-1', workspaceId: 'business-1', decision: 'aprobada' as const, via: 'panel' as const };
    const results = await Promise.all([decidir(db, args), decidir(db, args)]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(mocks.markPaid).toHaveBeenCalledTimes(1);
  });
  it('cannot execute an expired decision or a decision belonging to another business', async () => {
    for (const [expiry, workspaceId] of [[new Date(Date.now() - 60000).toISOString(), 'business-1'],
      [new Date(Date.now() + 60000).toISOString(), 'business-2']]) {
      const result = await decidir(fixture(expiry), { approvalId: 'approval-1', workspaceId, decision: 'aprobada', via: 'panel' });
      expect(result.ok).toBe(false);
    }
    expect(mocks.markPaid).not.toHaveBeenCalled();
  });
});
