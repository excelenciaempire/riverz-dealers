import { beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const mock = vi.hoisted(() => ({ platform: 'woocommerce', get: vi.fn() }))
vi.mock('./order-lookup', () => ({ resolveStoreForLookup: async () => ({ platform: mock.platform, shopDomain: 'example.com', accessToken: 'token', apiSecret: 'secret', externalStoreId: 'store' }) }))
vi.mock('./providers/woocommerce', () => ({
  WooCommerceClient: class { get = mock.get },
  wooFechaAIso: (_local: string, utc: string) => utc ? utc + 'Z' : null,
}))
vi.mock('./providers/tiendanube', () => ({ TiendanubeClient: class { get = mock.get } }))
import { fetchRecentOrdersOtherPlatform } from './recent-orders'
import { esVentaReal } from '@/lib/attribution/lentes'
beforeEach(() => { mock.platform = 'woocommerce'; mock.get.mockReset() })

it('uses payment evidence for WooCommerce rather than a fulfillment status', async () => {
  mock.get.mockResolvedValue([
    { id: 1, status: 'processing', date_paid_gmt: '2026-09-20T10:00:00' },
    { id: 2, status: 'completed', date_paid: null },
    { id: 3, status: 'cancelled', date_paid_gmt: '2026-09-20T10:00:00' },
    { id: 4, status: 'refunded', date_paid_gmt: '2026-09-20T10:00:00' },
  ])
  const result = await fetchRecentOrdersOtherPlatform({} as SupabaseClient, 'workspace', '2026-09-01T00:00:00Z')
  expect(result?.orders.filter(esVentaReal).map(order => order.id)).toEqual([1])
})
it('preserves Tiendanube paid status and excludes pending receipts', async () => {
  mock.platform = 'tiendanube'
  mock.get.mockResolvedValue([{ id: 1, payment_status: 'paid' }, { id: 2, payment_status: 'pending' }])
  const result = await fetchRecentOrdersOtherPlatform({} as SupabaseClient, 'workspace', '2026-09-01T00:00:00Z')
  expect(result?.orders.filter(esVentaReal).map(order => order.id)).toEqual([1])
})
