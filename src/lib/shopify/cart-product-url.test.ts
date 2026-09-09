import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cartProductUrl, productPageUrl } from './cart-product-url'

describe('cart product destination', () => {
  it('preserves the selected variant and existing query parameters', () => {
    expect(productPageUrl('https://shop.test/products/ref-4?source=wa', 123))
      .toBe('https://shop.test/products/ref-4?source=wa&variant=123')
    expect(() => productPageUrl('javascript:alert(1)', 123)).toThrow()
  })
  it('matches the first item only within the same workspace and store', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() }
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.limit.mockReturnValue(query)
    query.maybeSingle.mockResolvedValueOnce({ data: { shop_domain: 'merchant.myshopify.com', line_items: [
      { product_id: 111, variant_id: 222 }, { product_id: 333, variant_id: 444 },
    ] } }).mockResolvedValueOnce({ data: { url: 'https://shop.test/products/reference' } })
    const db = { from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient
    expect(await cartProductUrl(db, 'merchant', 'https://shop.test/checkouts/a'))
      .toBe('https://shop.test/products/reference?variant=222')
    expect(query.eq).toHaveBeenCalledWith('workspace_id', 'merchant')
    expect(query.eq).toHaveBeenCalledWith('shop_domain', 'merchant.myshopify.com')
    expect(query.eq).toHaveBeenCalledWith('external_id', 111)
  })
  it('does not guess a destination when the cart is missing', async () => {
    const query = { select: () => query, eq: () => query, limit: () => query, maybeSingle: async () => ({ data: null }) }
    expect(await cartProductUrl({ from: () => query } as unknown as SupabaseClient, 'merchant', 'missing')).toBeNull()
  })
})
