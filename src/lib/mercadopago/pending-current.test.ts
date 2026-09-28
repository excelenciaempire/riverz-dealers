import { afterEach, expect, it, vi } from 'vitest'
vi.mock('./oauth', () => ({ freshAccessToken: vi.fn() }))
import { freshAccessToken } from './oauth'
import { currentPendingPayment } from './pending'
const cash = { id:123,status:'pending',status_detail:'pending_waiting_payment',payment_type_id:'ticket',
  transaction_amount:100,date_created:'2026-09-27T12:00:00Z',external_reference:'order-1' }
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })
it('stops an unpaid cash voucher if the same purchase was paid in another attempt', async () => {
  vi.mocked(freshAccessToken).mockResolvedValue('test-token')
  const request = vi.fn().mockResolvedValueOnce({ok:true,json:async()=>cash})
    .mockResolvedValueOnce({ok:true,json:async()=>({results:[{...cash,id:124,status:'approved'}],paging:{total:1}})})
  vi.stubGlobal('fetch',request)
  expect((await currentPendingPayment({} as never,'ws','123')).status).toBe('approved')
  expect(request.mock.calls[1][0]).toContain('external_reference=order-1')
})
it('does not infer a payment from another purchase and leaves an actionable voucher pending', async () => {
  vi.mocked(freshAccessToken).mockResolvedValue('test-token')
  const request = vi.fn().mockResolvedValueOnce({ok:true,json:async()=>cash})
    .mockResolvedValueOnce({ok:true,json:async()=>({results:[{...cash,id:124,status:'approved',external_reference:'another-order'}],paging:{total:1}})})
  vi.stubGlobal('fetch',request)
  expect((await currentPendingPayment({} as never,'ws','123')).status).toBe('pending')
})
it('does not use stale status if another-attempt verification fails or the connection is missing', async () => {
  vi.mocked(freshAccessToken).mockResolvedValue('test-token')
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:true,json:async()=>cash})
    .mockResolvedValueOnce({ok:false,status:503,text:async()=>''}))
  await expect(currentPendingPayment({} as never,'ws','123')).rejects.toThrow('503')
  vi.mocked(freshAccessToken).mockResolvedValue(null)
  await expect(currentPendingPayment({} as never,'ws','123')).rejects.toThrow('unavailable')
})
