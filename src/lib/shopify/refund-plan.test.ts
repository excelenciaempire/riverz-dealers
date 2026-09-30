import { describe, expect, it } from 'vitest'
import { planRefund, refundMoney, refundMoneyText, verifiedRefundTransactions, type RefundTransaction } from './refund-plan'
const charge = (id: number, amount: string): RefundTransaction => ({ id, amount, kind: 'sale', status: 'success', gateway: 'card' })
const returned = (parent_id: number, amount: string, status = 'success'): RefundTransaction => ({ id: 99, parent_id, amount, kind: 'refund', status, gateway: 'card' })
describe('refund allocation against real remaining charges', () => {
  it('subtracts previous returns across split payments and refunds only the remaining amount', () => {
    expect(planRefund([charge(1, '50.00'), charge(2, '30.00'), returned(1, '20.00')])).toEqual({ ok: true, amount: '60.00', transactions: [
      { parent_id: 1, amount: '30.00', kind: 'refund', gateway: 'card' }, { parent_id: 2, amount: '30.00', kind: 'refund', gateway: 'card' },
    ] })
  })
  it('allocates a partial return without changing its requested amount', () => {
    expect(planRefund([charge(1, '50.00'), charge(2, '30.00'), returned(1, '40.00')], 25)).toMatchObject({ ok: true, amount: '25.00', transactions: [{ parent_id: 1, amount: '10.00' }, { parent_id: 2, amount: '15.00' }] })
    expect(planRefund([charge(1, '50.00'), returned(1, '40.00')], 11)).toEqual({ ok: false, error: 'monto_mayor_al_cobrado' })
  })
  it('does not write through pending refunds or unverified transaction histories', () => {
    expect(planRefund([charge(1, '50.00'), returned(1, '10.00', 'pending')])).toEqual({ ok: false, error: 'refund_pending' })
    expect(planRefund([charge(1, '50.00'), returned(2, '10.00')])).toEqual({ ok: false, error: 'refund_history_unverified' })
    expect(planRefund([charge(1, '50.00'), returned(1, '60.00')])).toEqual({ ok: false, error: 'refund_history_unverified' })
    expect(planRefund([charge(1, '50.00'), returned(1, '50.00')])).toEqual({ ok: false, error: 'refund_already_returned' })
    expect(planRefund([charge(1, 'bad')])).toEqual({ ok: false, error: 'refund_history_unverified' })
  })
  it('rejects invalid requested money and preserves three-decimal amounts exactly', () => {
    for (const amount of [0, -5, NaN, Infinity, 0.0000001]) expect(planRefund([charge(1, '50.00')], amount).ok).toBe(false)
    expect(planRefund([charge(1, '2.123'), returned(1, '0.122')], 1.001)).toMatchObject({ ok: true, amount: '1.001' })
    expect(refundMoneyText(refundMoney('0.10')! + refundMoney('0.20')!)).toBe('0.30')
  })
  it('ignores failed returns and refuses a success label for pending, failed or mismatched provider transactions', () => {
    expect(planRefund([charge(1, '50.00'), returned(1, '10.00', 'failure')])).toMatchObject({ ok: true, amount: '50.00' })
    const expected = [{ parent_id: 1, amount: '10.00' }]
    expect(verifiedRefundTransactions([returned(1, '10.00')], expected)).toBe(true)
    for (const rows of [[], [returned(1, '10.00', 'pending')], [returned(1, '9.00')], [returned(2, '10.00')]]) expect(verifiedRefundTransactions(rows, expected)).toBe(false)
  })
})
