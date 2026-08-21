import { describe, it, expect } from 'vitest'
import { extractWooTracking, normalizeWooOrder, wooFechaAIso } from './woocommerce'

/**
 * Había dos lectores del seguimiento de WooCommerce mirando claves distintas:
 * el mismo pedido mostraba el número por el camino del webhook y no por el de
 * "¿dónde está mi pedido?", que es donde el cliente lo pide.
 */
describe('extractWooTracking', () => {
  it('lee las claves de los dos lectores que había', () => {
    expect(
      extractWooTracking([
        { key: '_tracking_number', value: 'AR123' },
        { key: '_shipping_provider', value: 'Andreani' },
        { key: '_tracking_url', value: 'https://andreani.com/AR123' },
      ]),
    ).toEqual({
      number: 'AR123',
      company: 'Andreani',
      url: 'https://andreani.com/AR123',
    })

    expect(
      extractWooTracking([
        { key: '_tracking_number', value: 'AR456' },
        { key: '_tracking_provider', value: 'OCA' },
        { key: '_custom_tracking_link', value: 'https://oca.com/AR456' },
      ]),
    ).toEqual({
      number: 'AR456',
      company: 'OCA',
      url: 'https://oca.com/AR456',
    })
  })

  it('desarma el array serializado de Shipment Tracking', () => {
    expect(
      extractWooTracking([
        {
          key: '_wc_shipment_tracking_items',
          value: [{ tracking_number: 'AR789', tracking_provider: 'Correo Argentino' }],
        },
      ]),
    ).toEqual({ number: 'AR789', company: 'Correo Argentino', url: '' })
  })

  it('sin plugin de seguimiento devuelve vacío', () => {
    expect(extractWooTracking(undefined)).toEqual({ number: '', company: '', url: '' })
    expect(extractWooTracking([{ key: '_otra_cosa', value: 'x' }]).number).toBe('')
  })
})

describe('wooFechaAIso', () => {
  it('usa la fecha en UTC y no la de la zona de la tienda', () => {
    // Las dos son el MISMO pedido: una tienda en Buenos Aires (UTC-3).
    expect(wooFechaAIso('2026-08-20T10:00:00', '2026-08-20T13:00:00')).toBe(
      '2026-08-20T13:00:00Z',
    )
  })

  it('sin la versión GMT asume UTC en vez de la zona del servidor', () => {
    expect(wooFechaAIso('2026-08-20T10:00:00', null)).toBe('2026-08-20T10:00:00Z')
  })

  it('respeta la fecha que ya viene con zona', () => {
    expect(wooFechaAIso(null, '2026-08-20T13:00:00Z')).toBe('2026-08-20T13:00:00Z')
    expect(wooFechaAIso('2026-08-20T10:00:00-03:00', null)).toBe('2026-08-20T10:00:00-03:00')
  })

  it('sin fecha no inventa una', () => {
    expect(wooFechaAIso(null, undefined)).toBeNull()
  })
})

describe('normalizeWooOrder', () => {
  it('deja la fecha del pedido en un instante comparable', () => {
    const order = normalizeWooOrder({
      id: 12,
      number: '12',
      status: 'processing',
      total: '100.00',
      currency: 'ARS',
      date_created: '2026-08-20T10:00:00',
      date_created_gmt: '2026-08-20T13:00:00',
      meta_data: [
        { key: '_tracking_number', value: 'AR123' },
        { key: '_shipping_provider', value: 'Andreani' },
      ],
    })

    expect(order?.createdAt).toBe('2026-08-20T13:00:00Z')
    expect(order?.trackingNumber).toBe('AR123')
    expect(order?.trackingCompany).toBe('Andreani')
  })
})
