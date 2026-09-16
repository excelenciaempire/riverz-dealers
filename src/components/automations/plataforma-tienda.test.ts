import { describe, expect, it } from 'vitest'
import {
  PLATFORM_ICON,
  esActivadorDeTienda,
  triggerStorePlatform,
} from './plataforma-tienda'

describe('triggerStorePlatform', () => {
  it('usa la plataforma del filtro cuando hay exactamente una', () => {
    expect(
      triggerStorePlatform(
        'shopify_abandoned_checkout',
        { platforms: ['tiendanube'] },
        ['shopify', 'tiendanube']
      )
    ).toBe('tiendanube')
  })

  it('sin filtro, resuelve a la única tienda conectada', () => {
    expect(
      triggerStorePlatform('shopify_order_created', {}, ['tiendanube'])
    ).toBe('tiendanube')
    expect(triggerStorePlatform('shopify_order_created', {}, ['shopify'])).toBe(
      'shopify'
    )
  })

  it('con varias conectadas y sin filtro no inventa una', () => {
    expect(
      triggerStorePlatform('shopify_order_created', {}, [
        'shopify',
        'tiendanube',
      ])
    ).toBeNull()
  })

  it('con el filtro en varias plataformas tampoco elige una', () => {
    expect(
      triggerStorePlatform(
        'shopify_order_created',
        { platforms: ['shopify', 'tiendanube'] },
        ['shopify', 'tiendanube']
      )
    ).toBeNull()
  })

  it('los activadores que no son de tienda no tienen plataforma', () => {
    expect(triggerStorePlatform('tag_added', {}, ['tiendanube'])).toBeNull()
    expect(triggerStorePlatform('payment_rejected', {}, ['shopify'])).toBeNull()
  })

  it('tolera config nula o sin platforms', () => {
    expect(triggerStorePlatform('shopify_order_paid', null, ['shopify'])).toBe(
      'shopify'
    )
    expect(
      triggerStorePlatform('shopify_order_paid', { platforms: 'shopify' }, [
        'shopify',
      ])
    ).toBe('shopify')
  })

  it('cada plataforma conocida tiene logo', () => {
    for (const p of ['shopify', 'tiendanube', 'woocommerce'])
      expect(PLATFORM_ICON[p]).toMatch(/^\/channels\/.+\.svg$/)
  })

  it('reconoce los activadores de tienda por su nombre histórico', () => {
    expect(esActivadorDeTienda('shopify_order_created')).toBe(true)
    expect(esActivadorDeTienda('keyword_match')).toBe(false)
  })
})
