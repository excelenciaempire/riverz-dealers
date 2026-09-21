import { afterEach, describe, expect, it, vi } from 'vitest'
import { replaceUnfulfilledOrderItems } from './order-edit'

const admin = {
  shopDomain: 'tienda.myshopify.com',
  accessToken: 'token',
  apiVersion: '2026-07',
}

describe('replaceUnfulfilledOrderItems', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reemplaza variantes y deja gratis la unidad cubierta por la oferta', async () => {
    const replies = [
      {
        data: {
          orderEditBegin: {
            calculatedOrder: {
              id: 'gid://shopify/CalculatedOrder/1',
              lineItems: { nodes: [{ id: 'gid://shopify/CalculatedLineItem/old', quantity: 1 }] },
            },
            userErrors: [],
          },
        },
      },
      { data: { orderEditSetQuantity: { userErrors: [] } } },
      {
        data: {
          orderEditAddVariant: {
            calculatedLineItem: { id: 'gid://shopify/CalculatedLineItem/white' },
            userErrors: [],
          },
        },
      },
      {
        data: {
          orderEditAddVariant: {
            calculatedLineItem: { id: 'gid://shopify/CalculatedLineItem/black' },
            userErrors: [],
          },
        },
      },
      {
        data: {
          orderEditAddLineItemDiscount: {
            addedDiscountStagedChange: { id: 'gid://shopify/OrderStagedChangeAddLineItemDiscount/1' },
            userErrors: [],
          },
        },
      },
      { data: { orderEditCommit: { order: { id: 'gid://shopify/Order/1010' }, userErrors: [] } } },
    ]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const next = replies.shift()
      return new Response(JSON.stringify(next), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await replaceUnfulfilledOrderItems(admin, '1010', [
      { variantId: '111', quantity: 1 },
      { variantId: '222', quantity: 1, free: true },
    ])

    expect(result).toEqual({
      ok: true,
      items: [
        { variantId: '111', quantity: 1, free: false },
        { variantId: '222', quantity: 1, free: true },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(6)
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    expect(bodies[1].variables).toMatchObject({ lineItemId: 'gid://shopify/CalculatedLineItem/old' })
    expect(bodies[1].query).toContain('quantity:0')
    expect(bodies[2].variables.variantId).toBe('gid://shopify/ProductVariant/111')
    expect(bodies[3].variables.variantId).toBe('gid://shopify/ProductVariant/222')
    expect(bodies[4].query).toContain('percentValue:100')
    expect(bodies[5].variables.note).toContain('confirmaci')
  })

  it('rechaza una lista vacía antes de tocar Shopify', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(replaceUnfulfilledOrderItems(admin, '1010', [])).resolves.toEqual({
      ok: false,
      error: 'invalid_items',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
