import { describe, expect, it } from 'vitest'
import { TRIGGER_OPTIONS, activadorSoportado, triggerLabel } from './activador'

const t = (key: string) => key

describe('triggerLabel', () => {
  it('nombra los activadores que se ofrecen', () => {
    expect(triggerLabel('shopify_order_created', t)).toBe(
      'automations.triggerShopifyOrderCreated'
    )
    expect(triggerLabel('tag_added', t)).toBe('automations.triggerTagAdded')
  })

  it('nombra los heredados que no están en la lista', () => {
    expect(triggerLabel('customer_inactive', t)).toBe(
      'automations.triggerCustomerInactive'
    )
  })

  it('ante un activador desconocido devuelve el valor crudo y no rompe', () => {
    expect(triggerLabel('algo_nuevo', t)).toBe('algo_nuevo')
  })
})

describe('activadorSoportado', () => {
  it('sin tienda resuelta no bloquea nada', () => {
    expect(activadorSoportado('shopify_order_confirmed', null)).toBe(true)
  })

  it('"pedido confirmado" solo lo emite Shopify', () => {
    expect(activadorSoportado('shopify_order_confirmed', 'shopify')).toBe(true)
    expect(activadorSoportado('shopify_order_confirmed', 'tiendanube')).toBe(
      false
    )
    expect(activadorSoportado('shopify_order_confirmed', 'woocommerce')).toBe(
      false
    )
  })

  it('el resto de los activadores de pedido valen para cualquier tienda', () => {
    for (const trigger of [
      'shopify_order_created',
      'shopify_order_paid',
      'shopify_order_fulfilled',
      'shopify_order_delivered',
      'shopify_order_cancelled',
      'shopify_order_refunded',
      'shopify_abandoned_checkout',
    ])
      expect(activadorSoportado(trigger, 'tiendanube')).toBe(true)
  })

  it('cada opción ofrecida tiene clave de i18n', () => {
    for (const o of TRIGGER_OPTIONS)
      expect(o.label.startsWith('automations.')).toBe(true)
  })
})
