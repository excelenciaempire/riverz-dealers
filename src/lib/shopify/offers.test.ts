import { describe, expect, it } from 'vitest'
import { resolveOfferChosen, resolveOfferFromConfig } from './offers'

function dbWithOffers(offers: Array<Record<string, unknown>>) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: async () => ({ data: [{ allowed_offers: offers }] }),
    maybeSingle: async () => ({ data: null }),
  }
  return { from: () => chain } as never
}

describe('ofertas de pedidos editados', () => {
  it('ignora líneas históricas eliminadas por Shopify', () => {
    const offer = resolveOfferFromConfig(
      {
        line_items: [
          { product_id: 'puma', quantity: 1, current_quantity: 0 },
          { product_id: 'puma', quantity: 1, current_quantity: 1 },
          { product_id: 'puma', quantity: 1, current_quantity: 1 },
        ],
      },
      {
        productOffers: new Map([['puma', [{ label: 'Paga 1 y lleva 2', units: 2 }]]]),
        checkoutOffers: [],
      },
    )
    expect(offer).toEqual({ label: 'Paga 1 y lleva 2', units: 2 })
  })

  it('detecta la cantidad que corresponde por el total pagado', async () => {
    const offer = await resolveOfferChosen(
      dbWithOffers([
        { label: '1 par', units: 1, total: 249900 },
        { label: 'Paga 1 par y llévate 2', units: 2, total: 249900 },
      ]),
      'workspace',
      {
        current_total_price: '249900.00',
        line_items: [{ product_id: 'puma', quantity: 1, current_quantity: 1 }],
      },
    )
    expect(offer).toEqual({
      label: 'Paga 1 par y llévate 2',
      units: 1,
      entitledUnits: 2,
    })
  })
})
