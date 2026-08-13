import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./admin-client', () => ({
  markShopifyConnectionExpired: vi.fn(),
}))

import { lookupCustomerOrders } from './order-lookup'

const BASE = {
  shopDomain: 'tienda.myshopify.com',
  accessToken: 'token',
  apiVersion: '2026-01',
}

/** Pedido de OTRA compradora, tal como lo devuelve /orders.json?name=… */
const FOREIGN_ORDER = {
  id: 1,
  name: '#1042',
  created_at: '2026-08-01T00:00:00Z',
  financial_status: 'paid',
  fulfillment_status: 'fulfilled',
  total_price: '120000',
  currency: 'COP',
  line_items: [{ title: 'Serum', quantity: 2 }],
  fulfillments: [{ tracking_number: 'TRK-999', tracking_url: null }],
  email: 'otra@example.com',
  phone: '+573001112233',
  customer: { email: 'otra@example.com', phone: '+573001112233' },
  shipping_address: { phone: '+573001112233' },
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lookupCustomerOrders — pertenencia del pedido', () => {
  it('no devuelve el pedido de otra clienta cuando se pide por número', async () => {
    // 1ª llamada: búsqueda por name → devuelve el pedido ajeno.
    // 2ª llamada: fallback por cliente → sin coincidencias.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ orders: [FOREIGN_ORDER] }))
      .mockResolvedValueOnce(jsonResponse({ customers: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await lookupCustomerOrders({
      ...BASE,
      customerPhone: '+573009998877',
      orderNumber: '1042',
    })

    expect(result).toEqual({ found: false, orders: [] })
  })

  it('sí devuelve el pedido cuando el teléfono del contacto coincide', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ orders: [FOREIGN_ORDER] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await lookupCustomerOrders({
      ...BASE,
      // Mismo número con formato local: el match es por los últimos 8 dígitos.
      customerPhone: '3001112233',
      orderNumber: '#1042',
    })

    expect(result.found).toBe(true)
    expect(result.orders[0].name).toBe('#1042')
    expect(result.orders[0].tracking_number).toBe('TRK-999')
  })

  it('sí devuelve el pedido cuando el correo del contacto coincide', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ orders: [FOREIGN_ORDER] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await lookupCustomerOrders({
      ...BASE,
      customerEmail: 'Otra@Example.com',
      orderNumber: '1042',
    })

    expect(result.found).toBe(true)
  })

  it('sin teléfono ni correo del contacto no entrega nada', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ orders: [FOREIGN_ORDER] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await lookupCustomerOrders({ ...BASE, orderNumber: '1042' })

    expect(result).toEqual({ found: false, orders: [] })
  })
})
