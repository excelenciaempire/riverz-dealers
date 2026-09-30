import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const m = vi.hoisted(() => ({ refund: vi.fn(), orderUpdates: vi.fn(), rpc:vi.fn(), currentPhone:vi.fn() }))
vi.mock('@/lib/approvals/ask',() => ({ APROBACION_PENDIENTE:'pendiente',quienDecide:m.currentPhone }))
vi.mock('@/lib/shopify/order-tags', () => ({ resolveShopifyAdmin: async () => ({ shopDomain: 'test.myshopify.com' }) }))
vi.mock('@/lib/shopify/order-cancel', () => ({ refundOrder: m.refund, cancelOrder: vi.fn() }))
vi.mock('@/lib/i18n/cuenta', () => ({ localeDeCuenta: async () => 'en' }))
import { decidir,resolveByCode } from './resolve'
function fixture(amount: unknown = 25, role='admin') {
  const approval: Record<string, unknown> = { id: 'approval', workspace_id: 'ws', kind: 'reembolsar_pedido', status: 'pendiente',
    notified_phone:'155512345678',payload: { shopify_order_id: '100', order_id: 'local', amount }, expires_at: new Date(Date.now() + 60000).toISOString() }
  const db = { rpc:m.rpc, from: (table: string) => {
    let patch: Record<string, unknown> = {}
    let list=false
    const predicates: ((row: Record<string, unknown>) => boolean)[] = []
    const resolve = () => {
      if (table === 'workspace_members') return { data:{ role },error:null }
      if (table === 'orders') { m.orderUpdates(patch); return { data: null, error: null } }
      if (!predicates.every(p => p(approval))) return { data: null, error: null }
      Object.assign(approval, patch); return { data:list ? [{ ...approval }] : { ...approval }, error: null }
    }
    const q = { update: (value: Record<string, unknown>) => { patch = value; return q }, eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return q },
      gt: (key: string, value: string) => { predicates.push(row => String(row[key]) > value); return q }, select: () => q, maybeSingle: async () => resolve(),
      like:(key:string,value:string) => { predicates.push(row => String(row[key]).endsWith(value.replace('%','')));return q },
      order:() => { list=true;return q },limit:() => q,
      then: (done: (value: unknown) => unknown) => Promise.resolve(resolve()).then(done) }
    return q
  } } as unknown as SupabaseClient
  return { db, approval }
}
const args = { approvalId: 'approval', workspaceId: 'ws', decision: 'aprobada' as const, via: 'panel' as const, decidedBy:'actor' }
beforeEach(() => { m.refund.mockReset(); m.orderUpdates.mockReset(); m.rpc.mockReset().mockResolvedValue({ data:true,error:null });m.currentPhone.mockReset().mockResolvedValue('155512345678') })
describe('approved refund truth in Riverz', () => {
  it('keeps the local order partially refunded when Shopify reports a partial result', async () => {
    m.refund.mockResolvedValue({ ok: true, financialStatus: 'partially_refunded', refundedAmount: '25.00' })
    const { db,approval } = fixture()
    expect((await decidir(db, args)).ok).toBe(true)
    expect(m.orderUpdates).toHaveBeenCalledWith({ financial_status: 'partially_refunded' })
    expect(approval.execution_result).toMatchObject({ refunded_amount:'25.00',financial_status:'partially_refunded' })
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
  it('does not call Shopify when another manual or assistant operation owns the order lock', async () => {
    m.rpc.mockResolvedValueOnce({ data:false,error:null })
    const { db } = fixture()
    expect((await decidir(db,args)).ok).toBe(false)
    expect(m.refund).not.toHaveBeenCalled()
  })
  it('retains the order lock when a provider result cannot be verified', async () => {
    m.refund.mockResolvedValue({ ok:false,uncertain:true,error:'refund_result_unverified' })
    await decidir(fixture().db,args)
    expect(m.rpc).toHaveBeenCalledWith('finish_approved_order_execution',expect.objectContaining({ p_uncertain:true }))
  })
  it('leaves the request pending when an unauthorized teammate tries to consume a financial decision',async () => {
    const { db,approval }=fixture(25,'agent')
    expect((await decidir(db,args)).ok).toBe(false)
    expect(approval.status).toBe('pendiente')
    expect(m.rpc).not.toHaveBeenCalled(); expect(m.refund).not.toHaveBeenCalled()
  })
  it('does not honor a financial approval sent to a former WhatsApp decision recipient',async () => {
    m.currentPhone.mockResolvedValue('155598765432')
    const { db,approval }=fixture()
    expect((await resolveByCode(db,{ code:'approv',decision:'aprobada',phone:'155512345678' })).ok).toBe(false)
    expect(approval.status).toBe('pendiente')
    expect(m.rpc).not.toHaveBeenCalled();expect(m.refund).not.toHaveBeenCalled()
  })
})
