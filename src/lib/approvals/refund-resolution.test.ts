import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const m = vi.hoisted(() => ({ refund: vi.fn(), orderUpdates: vi.fn() }))
vi.mock('@/lib/shopify/order-tags', () => ({ resolveShopifyAdmin: async () => ({ shopDomain: 'test.myshopify.com' }) }))
vi.mock('@/lib/shopify/order-cancel', () => ({ refundOrder: m.refund, cancelOrder: vi.fn() }))
vi.mock('@/lib/i18n/cuenta', () => ({ localeDeCuenta: async () => 'en' }))
import { decidir } from './resolve'
function fixture(amount: unknown = 25) {
  const approval: Record<string, unknown> = { id: 'approval', workspace_id: 'ws', kind: 'reembolsar_pedido', status: 'pendiente',
    payload: { shopify_order_id: '100', order_id: 'local', amount }, expires_at: new Date(Date.now() + 60000).toISOString() }
  const db = { from: (table: string) => {
    let patch: Record<string, unknown> = {}
    const predicates: ((row: Record<string, unknown>) => boolean)[] = []
    const resolve = () => {
      if (table === 'orders') { m.orderUpdates(patch); return { data: null, error: null } }
      if (!predicates.every(p => p(approval))) return { data: null, error: null }
      Object.assign(approval, patch); return { data: { ...approval }, error: null }
    }
    const q = { update: (value: Record<string, unknown>) => { patch = value; return q }, eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return q },
      gt: (key: string, value: string) => { predicates.push(row => String(row[key]) > value); return q }, select: () => q, maybeSingle: async () => resolve(),
      then: (done: (value: unknown) => unknown) => Promise.resolve(resolve()).then(done) }
    return q
  } } as unknown as SupabaseClient
  return { db, approval }
}
const args = { approvalId: 'approval', workspaceId: 'ws', decision: 'aprobada' as const, via: 'panel' as const }
beforeEach(() => { m.refund.mockReset(); m.orderUpdates.mockReset() })
describe('approved refund truth in Riverz', () => {
  it('keeps the local order partially refunded when Shopify reports a partial result', async () => {
    m.refund.mockResolvedValue({ ok: true, financialStatus: 'partially_refunded', refundedAmount: '25.00' })
    const { db } = fixture()
    expect((await decidir(db, args)).ok).toBe(true)
    expect(m.orderUpdates).toHaveBeenCalledWith({ financial_status: 'partially_refunded' })
  })
  it('does not mark an uncertain refund completed or change the local financial mirror', async () => {
    m.refund.mockResolvedValue({ ok: false, refundId: '50', error: 'refund_result_unverified' })
    const { db, approval } = fixture()
    const result = await decidir(db, args)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Verify the operation')
    expect(approval.status).toBe('fallida')
    expect(m.orderUpdates).not.toHaveBeenCalled()
    await decidir(db, args)
    expect(m.refund).toHaveBeenCalledTimes(1)
  })
  it('never interprets a malformed partial amount as permission to refund the whole order', async () => {
    const { db } = fixture('25')
    const result = await decidir(db, args)
    expect(result.ok).toBe(false)
    expect(result.message).toBe('The refund amount is invalid.')
    expect(m.refund).not.toHaveBeenCalled()
  })
})
