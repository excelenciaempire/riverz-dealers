import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ rest: vi.fn() }))
vi.mock('./admin-client', () => ({ ShopifyAdminClient: class { rest = m.rest }, ShopifyUnauthorizedError: class extends Error {} }))
import { refundOrder } from './order-cancel'
const admin = { shopDomain: 'shop.myshopify.com', accessToken: 'test', apiVersion: '2025-10' }
const charge = { id: 1, kind: 'sale', status: 'success', amount: '100.00', gateway: 'card' }
const refund = { id: 10, parent_id: 1, kind: 'refund', status: 'success', amount: '25.00', gateway: 'card' }
beforeEach(() => m.rest.mockReset())
describe('shared Shopify refund execution', () => {
  it('verifies provider transactions and returns the actual partial financial state', async () => {
    m.rest.mockResolvedValueOnce({ transactions: [charge] })
      .mockResolvedValueOnce({ refund: { id: 50, transactions: [refund] } })
      .mockResolvedValueOnce({ order: { financial_status: 'partially_refunded', currency: 'USD' } })
    expect(await refundOrder(admin, '100', { amount: 25 })).toEqual({ ok: true, refundId: '50', refundedAmount: '25.00', financialStatus: 'partially_refunded', currency: 'USD' })
    expect(m.rest).toHaveBeenNthCalledWith(2, '/orders/100/refunds.json', expect.objectContaining({ body: { refund: expect.objectContaining({ transactions: [{ parent_id: 1, amount: '25.00', kind: 'refund', gateway: 'card' }] }) } }))
  })
  it('does not post an excessive refund against the remaining balance', async () => {
    m.rest.mockResolvedValueOnce({ transactions: [charge, { ...refund, amount: '90.00' }] })
    expect(await refundOrder(admin, '100', { amount: 25 })).toEqual({ ok: false, error: 'monto_mayor_al_cobrado' })
    expect(m.rest).toHaveBeenCalledTimes(1)
  })
  it('does not report pending, malformed or unverifiable provider responses as completed', async () => {
    for (const response of [{}, { refund: { id: 50, transactions: [{ ...refund, status: 'pending' }] } }, { refund: { id: 50, transactions: [refund] } }]) {
      m.rest.mockReset().mockResolvedValueOnce({ transactions: [charge] }).mockResolvedValueOnce(response).mockRejectedValueOnce(new Error('network'))
      expect((await refundOrder(admin, '100', { amount: 25 })).ok).toBe(false)
      expect(m.rest.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1)
    }
  })
})
