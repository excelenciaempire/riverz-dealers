import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * En Shopify, `create_order` ignoraba los `items` que manda el modelo.
 *
 * La ficha de la herramienta le pide desde siempre "cada producto con su
 * variant_id", y el camino de Shopify resolvía el producto por otro lado: el
 * detectado en la conversación, o el único configurado en la cuenta. Con un
 * catálogo de veinte productos, pedir cualquier otro terminaba en "no pude
 * resolver el producto de esta tienda" — un mensaje que encima culpa a la
 * tienda. Medido el 2026-08-24 sobre riverz-demo.myshopify.com.
 */

const VARIANTE = '48655116894347'
const OTRA = '48655117549707'

/** Devuelve el cuerpo con que se creó el pedido. */
function shopifyFalso() {
  const enviados: Record<string, unknown>[] = []
  const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/variants/')) {
      return new Response(JSON.stringify({ variant: { price: '699.95', title: 'x' } }), {
        status: 200,
      })
    }
    if (String(url).includes('/orders.json')) {
      enviados.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(
        JSON.stringify({
          order: { id: 1, name: '#1001', total_price: '699.95', currency: 'USD' },
        }),
        { status: 201 },
      )
    }
    return new Response('{}', { status: 200 })
  })
  return { enviados, fetchFalso }
}

const ctx = {
  shopDomain: 'demo.myshopify.com',
  accessToken: 'shpua_x',
  apiVersion: '2024-10',
}

describe('create_order en Shopify respeta lo que pidió la clienta', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('usa el variant que mandó el modelo, sin producto detectado ni default', async () => {
    const { enviados, fetchFalso } = shopifyFalso()
    vi.stubGlobal('fetch', fetchFalso)
    const { createShopifyOrder } = await import('./create-order')

    const r = await createShopifyOrder(
      { items: [{ variant_id: VARIANTE, quantity: 1 }], customer_name: 'Ana Ruiz' },
      ctx,
    )

    expect('error' in r ? r.error : null).toBeNull()
    const lineas = enviados[0]?.order as { line_items: Array<{ variant_id: string }> }
    expect(lineas.line_items[0].variant_id).toBe(VARIANTE)
  })

  it('con dos productos van los dos, no sólo el primero', async () => {
    // Mandar uno y callar el otro sería peor que fallar: la clienta pidió dos
    // cosas y recibiría una, sin que nadie se entere hasta que llegue.
    const { enviados, fetchFalso } = shopifyFalso()
    vi.stubGlobal('fetch', fetchFalso)
    const { createShopifyOrder } = await import('./create-order')

    await createShopifyOrder(
      {
        items: [
          { variant_id: VARIANTE, quantity: 2 },
          { variant_id: OTRA, quantity: 1 },
        ],
        customer_name: 'Ana Ruiz',
      },
      ctx,
    )

    const pedido = enviados[0]?.order as {
      line_items: Array<{ variant_id: string; quantity: number }>
    }
    expect(pedido.line_items).toHaveLength(2)
    expect(pedido.line_items.map((l) => l.variant_id)).toEqual([VARIANTE, OTRA])
    expect(pedido.line_items[0].quantity).toBe(2)
  })

  it('sin items sigue valiendo el producto detectado en la conversación', async () => {
    const { enviados, fetchFalso } = shopifyFalso()
    vi.stubGlobal('fetch', fetchFalso)
    const { createShopifyOrder } = await import('./create-order')

    await createShopifyOrder(
      { quantity: 1, customer_name: 'Ana Ruiz' },
      { ...ctx, pinnedVariantId: OTRA },
    )

    const pedido = enviados[0]?.order as { line_items: Array<{ variant_id: string }> }
    expect(pedido.line_items[0].variant_id).toBe(OTRA)
  })

  it('un variant_id que no es un número se descarta en vez de mandarse', async () => {
    const { fetchFalso } = shopifyFalso()
    vi.stubGlobal('fetch', fetchFalso)
    const { createShopifyOrder } = await import('./create-order')

    const r = await createShopifyOrder(
      { items: [{ variant_id: "1'; drop--" }], customer_name: 'Ana Ruiz' },
      ctx,
    )

    // Sin nada válido y sin producto detectado, corta con su error propio.
    expect('error' in r ? r.error : null).toBe('no_variant')
  })
})
