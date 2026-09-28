import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/mercadopago/pending', () => ({ currentPendingPayment: vi.fn(), isActionablePending: (p: {status:string}) => p.status === 'pending' }))
vi.mock('@/lib/attribution/shopify', () => ({ getActiveShopifyConnection: vi.fn(), fetchOrderFinancialStatus: vi.fn() }))
import { currentPendingPayment } from '@/lib/mercadopago/pending'
import { getActiveShopifyConnection, fetchOrderFinancialStatus } from '@/lib/attribution/shopify'
import { assertPaymentStillPending, claimPendingSequence, isPendingReminder, pendingPaymentCondition, assertNoPendingReplacement } from './pending-payment'
import { AwaitTemplateAvailability, StopSessionSequence } from './session-template'
const q = () => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: { status: 'open', payment_reported_at: null }, error: null }),
  single: vi.fn().mockResolvedValue({ data: { phone: '+573001234567' }, error: null }) })
beforeEach(() => vi.resetAllMocks())
describe('pending reminder send barrier', () => {
  it('paid conditions mean approved, not cancelled or expired', async () => {
    vi.mocked(currentPendingPayment).mockResolvedValue({id:123,status:'approved'})
    expect(await pendingPaymentCondition({} as never,'ws',{payment_id:'123'},true)).toBe(true)
    expect(await pendingPaymentCondition({} as never,'ws',{payment_id:'123'},false)).toBe(false)
    vi.mocked(currentPendingPayment).mockResolvedValue({id:123,status:'cancelled'})
    await expect(pendingPaymentCondition({} as never,'ws',{payment_id:'123'},true)).rejects.toBeInstanceOf(StopSessionSequence)
  })
  it('a later cash attempt stops earlier rejected/cart recovery for the same phone', async () => {
    const query={...q(),gte:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis()}
    query.maybeSingle.mockResolvedValue({data:{mp_payment_id:'123'} as never,error:null})
    vi.mocked(currentPendingPayment).mockResolvedValue({id:123,status:'pending'})
    await expect(assertNoPendingReplacement({from:()=>query} as never,'ws','buyer','2026-09-27T12:00:00Z')).rejects.toBeInstanceOf(StopSessionSequence)
  })
  it('is narrowly scoped to reminders, not confirmations or rejected payment flows', () => {
    expect(isPendingReminder('payment_pending', {})).toBe(true)
    expect(isPendingReminder('shopify_order_created', { pending_payment_reminder: true })).toBe(true)
    expect(isPendingReminder('shopify_order_created', {}, { pending_payment_reminder: true })).toBe(true)
    expect(isPendingReminder('shopify_order_created', {})).toBe(false)
    expect(isPendingReminder('payment_rejected', null)).toBe(false)
  })
  it('checks Mercado Pago again every time; approval stops the next reminder', async () => {
    vi.mocked(currentPendingPayment).mockResolvedValueOnce({ id:123, status:'pending' }).mockResolvedValueOnce({ id:123, status:'approved' })
    await assertPaymentStillPending({} as never, 'ws', 'payment_pending', null, { payment_id:'123' })
    await expect(assertPaymentStillPending({} as never, 'ws', 'payment_pending', null, { payment_id:'123' })).rejects.toBeInstanceOf(StopSessionSequence)
    expect(currentPendingPayment).toHaveBeenCalledTimes(2)
  })
  it('parks a run when Mercado Pago cannot confirm its current state', async () => {
    vi.mocked(currentPendingPayment).mockRejectedValue(new Error('unavailable'))
    await expect(assertPaymentStillPending({} as never, 'ws', 'payment_pending', null, { payment_id:'123' })).rejects.toBeInstanceOf(AwaitTemplateAvailability)
  })
  it('stops duplicate-source Shopify reminders after payment, cancellation or a reported receipt', async () => {
    vi.mocked(getActiveShopifyConnection).mockResolvedValue({} as never)
    vi.mocked(fetchOrderFinancialStatus).mockResolvedValueOnce('paid').mockResolvedValueOnce('pending')
    const query = q()
    query.maybeSingle.mockResolvedValue({ data:{ status:'cancelled', payment_reported_at:null }, error:null })
    const db = { from: () => query } as never
    await expect(assertPaymentStillPending(db, 'ws', 'shopify_order_created', null, { order_id:'123' })).rejects.toBeInstanceOf(StopSessionSequence)
    await expect(assertPaymentStillPending(db, 'ws', 'shopify_order_created', null, { order_id:'123' })).rejects.toBeInstanceOf(StopSessionSequence)
  })
  it('fails closed on lookup uncertainty and uses the same canonical phone for both sources', async () => {
    vi.mocked(getActiveShopifyConnection).mockResolvedValue(null)
    await expect(assertPaymentStillPending({} as never, 'ws', 'shopify_order_created', null, { order_id:'123' })).rejects.toBeInstanceOf(AwaitTemplateAvailability)
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    const db = { from: q, rpc } as never
    await expect(claimPendingSequence(db, 'ws', 'buyer', 'run')).rejects.toBeInstanceOf(StopSessionSequence)
    expect(rpc).toHaveBeenCalledWith('claim_pending_payment_sequence', { p_workspace_id:'ws', p_phone:'573001234567', p_log_id:'run' })
  })
})
