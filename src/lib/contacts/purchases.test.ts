import { describe, expect, it } from 'vitest'
import type { ContactPurchase } from '@/types'
import { shopifyOrderToPurchase, summarizePurchases } from './purchases'

function purchase(over: Partial<ContactPurchase> = {}): ContactPurchase {
  return {
    id: Math.random().toString(36).slice(2),
    workspace_id: 'ws',
    contact_id: 'c1',
    platform: 'shopify',
    shop_domain: 'tienda.myshopify.com',
    external_id: '1',
    order_number: '#1',
    placed_at: '2026-01-10T00:00:00Z',
    currency: 'ARS',
    total: 1000,
    financial_status: 'paid',
    fulfillment_status: null,
    line_items: [{ title: 'Serum', quantity: 1, price: 1000 }],
    customer_email: null,
    customer_phone: null,
    created_at: '2026-01-10T00:00:00Z',
    updated_at: '2026-01-10T00:00:00Z',
    ...over,
  }
}

describe('summarizePurchases', () => {
  it('cuenta los pedidos de la tienda aunque no tengamos el detalle', () => {
    // El caso que hacía dudar de todo: la tienda dice 3 compras y Riverz sólo
    // puede mostrar 1, porque Shopify no entrega pedidos de más de 60 días.
    const s = summarizePurchases([purchase()], { ordersCount: 3, totalSpent: 9000 })
    expect(s.ordersCount).toBe(3)
    expect(s.recordedCount).toBe(1)
    expect(s.missingDetail).toBe(2)
    expect(s.isRepeat).toBe(true)
  })

  it('no deja que el resumen de la tienda achique el historial guardado', () => {
    // Un comprador invitado no tiene ficha de cliente en la tienda: su
    // orders_count es 0 y sus pedidos existen igual.
    const s = summarizePurchases([purchase({ external_id: '1' }), purchase({ external_id: '2' })], {
      ordersCount: 0,
      totalSpent: 0,
    })
    expect(s.ordersCount).toBe(2)
    expect(s.missingDetail).toBe(0)
    expect(s.totalSpent).toBe(2000)
  })

  it('promedia sobre los pedidos de toda la vida, no sobre los visibles', () => {
    const s = summarizePurchases([purchase()], { ordersCount: 4, totalSpent: 8000 })
    expect(s.averageOrder).toBe(2000)
  })

  it('ordena las fechas y cuenta los días desde la última compra', () => {
    const dias = 5
    const reciente = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
    const s = summarizePurchases([
      purchase({ external_id: '2', placed_at: reciente }),
      purchase({ external_id: '1', placed_at: '2025-03-01T00:00:00Z' }),
    ])
    expect(s.firstPurchaseAt).toBe('2025-03-01T00:00:00.000Z')
    expect(s.daysSinceLast).toBe(dias)
  })

  it('suma unidades por producto', () => {
    const s = summarizePurchases([
      purchase({ external_id: '1', line_items: [{ title: 'Serum', quantity: 2, price: null }] }),
      purchase({
        external_id: '2',
        line_items: [
          { title: 'Serum', quantity: 1, price: null },
          { title: 'Crema', quantity: 3, price: null },
        ],
      }),
    ])
    expect(s.topProducts).toEqual([
      { title: 'Serum', quantity: 3 },
      { title: 'Crema', quantity: 3 },
    ])
  })

  it('sin compras no inventa nada', () => {
    const s = summarizePurchases([])
    expect(s.ordersCount).toBe(0)
    expect(s.lastPurchaseAt).toBeNull()
    expect(s.averageOrder).toBeNull()
    expect(s.isRepeat).toBe(false)
  })
})

describe('shopifyOrderToPurchase', () => {
  it('traduce el webhook y conserva email y teléfono para engancharlo después', () => {
    const p = shopifyOrderToPurchase('tienda.myshopify.com', {
      id: 998,
      name: '#1042',
      created_at: '2026-02-01T12:00:00Z',
      currency: 'ARS',
      total_price: '69900.00',
      financial_status: 'paid',
      line_items: [{ title: 'Serum', quantity: 2, price: '34950.00' }],
      email: 'Ana@Mail.com',
      shipping_address: { phone: '+54 9 11 5555 5555' },
    })
    expect(p).toMatchObject({
      externalId: '998',
      orderNumber: '#1042',
      total: '69900.00',
      customerEmail: 'Ana@Mail.com',
      customerPhone: '+54 9 11 5555 5555',
    })
    expect(p?.lineItems).toEqual([{ title: 'Serum', quantity: 2, price: '34950.00' }])
  })

  it('descarta un pedido sin id: no se podría deduplicar', () => {
    expect(shopifyOrderToPurchase('tienda.myshopify.com', { name: '#1' })).toBeNull()
  })
})
