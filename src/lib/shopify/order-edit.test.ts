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
          order: {
            id: 'gid://shopify/Order/1010',
            cancelledAt: null,
            displayFulfillmentStatus: 'UNFULFILLED',
            lineItems: { nodes: [{ quantity: 1, currentQuantity: 1, unfulfilledQuantity: 1 }] },
          },
        },
      },
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
      {
        data: {
          order: {
            id: 'gid://shopify/Order/1010',
            tags: ['Order sent to dropi'],
            totalPriceSet: { shopMoney: { amount: '249900.00', currencyCode: 'COP' } },
            lineItems: {
              nodes: [
                { title: 'Puma Suede XL', variantTitle: 'Blanco / 41', currentQuantity: 1, variant: { id: 'gid://shopify/ProductVariant/111' } },
                { title: 'Puma Suede XL', variantTitle: 'Negro / 41', currentQuantity: 1, variant: { id: 'gid://shopify/ProductVariant/222' } },
              ],
            },
          },
        },
      },
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
      verifiedItems: [
        { variantId: '111', quantity: 1, title: 'Puma Suede XL', variantTitle: 'Blanco / 41' },
        { variantId: '222', quantity: 1, title: 'Puma Suede XL', variantTitle: 'Negro / 41' },
      ],
      total: { amount: '249900.00', currencyCode: 'COP' },
      tags: ['Order sent to dropi'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(8)
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    expect(bodies[2].variables).toMatchObject({ lineItemId: 'gid://shopify/CalculatedLineItem/old' })
    expect(bodies[2].query).toContain('quantity:0')
    expect(bodies[3].variables.variantId).toBe('gid://shopify/ProductVariant/111')
    expect(bodies[4].variables.variantId).toBe('gid://shopify/ProductVariant/222')
    expect(bodies[5].query).toContain('percentValue:100')
    expect(bodies[6].variables.note).toContain('confirmaci')
    expect(bodies[7].query).toContain('currentQuantity')
  })

  it('rechaza una lista vacía antes de tocar Shopify', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(replaceUnfulfilledOrderItems(admin, '1010', [])).resolves.toEqual({
      ok: false,
      error: 'invalid_items',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no cambia un pedido que ya tiene unidades despachadas', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        data: {
          order: {
            id: 'gid://shopify/Order/1010',
            cancelledAt: null,
            displayFulfillmentStatus: 'PARTIALLY_FULFILLED',
            lineItems: { nodes: [{ quantity: 2, currentQuantity: 2, unfulfilledQuantity: 1 }] },
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    await expect(replaceUnfulfilledOrderItems(admin, '1010', [
      { variantId: '111', quantity: 1 },
      { variantId: '222', quantity: 1, free: true },
    ])).resolves.toEqual({ ok: false, error: 'order_already_fulfilled' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('no declara éxito si la lectura final no coincide con lo solicitado', async () => {
    const replies = [
      { data: { order: { id: 'gid://shopify/Order/1010', cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED', lineItems: { nodes: [{ quantity: 1, currentQuantity: 1, unfulfilledQuantity: 1 }] } } } },
      { data: { orderEditBegin: { calculatedOrder: { id: 'gid://shopify/CalculatedOrder/1', lineItems: { nodes: [] } }, userErrors: [] } } },
      { data: { orderEditAddVariant: { calculatedLineItem: { id: 'gid://shopify/CalculatedLineItem/white' }, userErrors: [] } } },
      { data: { orderEditCommit: { order: { id: 'gid://shopify/Order/1010' }, userErrors: [] } } },
      { data: { order: { id: 'gid://shopify/Order/1010', lineItems: { nodes: [{ title: 'Puma', variantTitle: 'Negro / 41', currentQuantity: 1, variant: { id: 'gid://shopify/ProductVariant/999' } }] } } } },
    ]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(replies.shift()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(replaceUnfulfilledOrderItems(admin, '1010', [
      { variantId: '111', quantity: 1 },
    ])).resolves.toMatchObject({
      ok: false,
      error: 'updated_but_verification_mismatch',
      verifiedItems: [{ variantId: '999', quantity: 1 }],
    })
  })
})
