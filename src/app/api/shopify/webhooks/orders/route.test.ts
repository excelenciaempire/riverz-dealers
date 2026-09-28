import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Un reembolso parcial no cancela nada.
 *
 * Devolver $5 de envío de un pedido de $100 marcaba el espejo como
 * 'cancelled': el comercio veía $0 de ingreso en vez de $95 y el agente
 * dejaba de encontrar el pedido —la consulta de posventa descarta los
 * cancelados—, así que la clienta que llamaba justo por ese envío escuchaba
 * "no encontré ningún pedido activo".
 */

interface Escritura {
  table: string
  /** 'update' reconcilia una fila que ya era nuestra; 'upsert' la crea. */
  op: 'update' | 'upsert' | 'select'
  payload: Record<string, unknown>
  filtros: Array<[string, unknown]>
}

const escrituras: Escritura[] = []
const { emittedWebhooks } = vi.hoisted(() => ({
  emittedWebhooks: [] as Array<{ type: string; data: Record<string, unknown> }>,
}))

/**
 * ¿Ya existe la fila espejo del pedido?
 *
 * Lo decide cada prueba: el espejo tiene DOS caminos y son distintos. Si la
 * fila existe se parchea sólo lo que Shopify sabe; si no existe se crea entera
 * con `created_by: 'sync'`. Antes esto era siempre `null` y las cinco pruebas
 * de reconciliación medían, sin saberlo, el camino de creación.
 */
let filaExistente: Record<string, string | null> | null = { id: 'ord1' }
let estadoFulfillment: Record<string, string | null> | null = null

function fakeAdmin() {
  return {
    from(table: string) {
      const estado = {
        payload: {} as Record<string, unknown>,
        filtros: [] as Array<[string, unknown]>,
        op: 'select' as Escritura['op'],
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        is: () => chain,
        in: () => chain,
        neq: () => chain,
        insert: () => chain,
        upsert(payload: Record<string, unknown>) {
          estado.payload = payload
          estado.op = 'upsert'
          return chain
        },
        update(payload: Record<string, unknown>) {
          estado.payload = payload
          estado.op = 'update'
          return chain
        },
        eq(col: string, val: unknown) {
          estado.filtros.push([col, val])
          return chain
        },
        maybeSingle: async () => {
          escrituras.push({ table, op: 'select', payload: {}, filtros: estado.filtros })
          return {
            data:
              table === 'orders'
                ? filaExistente
                : table === 'shopify_order_fulfillment_state'
                  ? estadoFulfillment
                  : null,
            error: null,
          }
        },
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => {
          if (estado.op !== 'select') {
            escrituras.push({ table, op: estado.op, payload: estado.payload, filtros: estado.filtros })
            estado.op = 'select'
          }
          return Promise.resolve({ data: null, error: null }).then(ok, fail)
        },
      }
      return chain
    },
    // Sin transición no hay disparador y la ruta termina ahí: alcanza para
    // observar la reconciliación del espejo, que corre antes.
    rpc: async () => ({ data: null, error: null }),
  }
}

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => fakeAdmin() }))
vi.mock('@/lib/shopify/webhook-auth', () => ({
  verifyShopifyWebhook: async () => 'valid',
}))
vi.mock('@/lib/shopify/connection', () => ({
  getConnectionByShop: async () => ({
    row: { id: 'conn1', user_id: 'u1', workspace_id: 'ws1' },
  }),
}))
vi.mock('@/lib/shopify/webhook-dedup', () => ({ isDuplicateDelivery: async () => false }))
vi.mock('@/lib/contacts/purchases', () => ({
  shopifyOrderToPurchase: () => null,
  recordPurchases: async () => {},
  linkOrphanPurchases: async () => {},
}))
vi.mock('@/lib/shopify/contact-upsert', () => ({
  extractShopifyPhone: () => null,
  extractShopifyName: () => undefined,
  extractShopifyLegacyPhone: () => null,
  upsertWhatsappContact: async () => null,
}))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: async () => {} }))
vi.mock('@/lib/contacts/tags', () => ({ applyCategoryTags: async () => {} }))
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => 'ws1' }))
vi.mock('@/lib/webhooks/capture', () => ({ captureWebhookFailure: async () => {} }))
vi.mock('@/lib/webhooks/outbound', () => ({
  emitWebhook: async (
    _workspaceId: string,
    type: string,
    data: Record<string, unknown>,
  ) => {
    emittedWebhooks.push({ type, data })
  },
}))
vi.mock('@/lib/channels/registry', () => ({ getAdapter: () => ({ sendText: async () => ({}) }) }))
vi.mock('@/lib/shopify/create-checkout', () => ({ fmtMoney: () => '' }))
vi.mock('@/lib/shopify/carrier-tracking', () => ({ resolveCarrierTrackingUrl: () => '' }))
vi.mock('@/lib/shopify/offers', () => ({
  resolveOfferChosen: async () => ({ label: '', units: 0 }),
}))
vi.mock('@/lib/channels/webchat/attribution', () => ({ attributeWebchatOrder: async () => {} }))
vi.mock('@/lib/shopify/discounts', () => ({ marcarCuponesUsados: async () => {} }))

import { POST } from './route'

function actualizacion(financialStatus: string, extra: Record<string, unknown> = {}) {
  const order = {
    id: 8811,
    financial_status: financialStatus,
    fulfillment_status: null,
    total_price: '100.00',
    currency: 'ARS',
    ...extra,
  }
  return new Request('https://riverz.co/api/shopify/webhooks/orders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': 'firma',
      'x-shopify-shop-domain': 'tienda.myshopify.com',
      'x-shopify-topic': 'orders/updated',
      'x-shopify-webhook-id': `wh-${financialStatus}`,
    },
    body: JSON.stringify(order),
  })
}

const espejo = () =>
  escrituras.find((e) => e.table === 'orders' && e.op !== 'select')
const busqueda = () =>
  escrituras.find((e) => e.table === 'orders' && e.op === 'select')

beforeEach(() => {
  escrituras.length = 0
  emittedWebhooks.length = 0
  filaExistente = { id: 'ord1' }
  estadoFulfillment = null
})

describe('POST /api/shopify/webhooks/orders — espejo de estados', () => {
  it('un reembolso parcial no cancela el pedido', async () => {
    await POST(actualizacion('partially_refunded'))

    const upd = espejo()
    expect(upd).toBeTruthy()
    expect(upd?.payload.financial_status).toBe('partially_refunded')
    // Lo que importa es que NO quede cancelado: sin esto el pedido salía de
    // los ingresos entero y desaparecía del buscador de posventa, así que la
    // clienta que llamaba justo por ese envío escuchaba "no encontré ningún
    // pedido activo".
    expect(upd?.payload.status).not.toBe('cancelled')
    expect(upd?.payload.status).toBe('created')
  })

  it('el reembolso total sí lo cancela', async () => {
    await POST(actualizacion('refunded'))

    expect(espejo()?.payload.status).toBe('cancelled')
  })

  it('un pedido anulado sigue cancelándose', async () => {
    await POST(actualizacion('voided'))

    expect(espejo()?.payload.status).toBe('cancelled')
  })

  it('un reembolso parcial de un pedido ya despachado lo deja despachado', async () => {
    await POST(actualizacion('partially_refunded', { fulfillment_status: 'fulfilled' }))

    expect(espejo()?.payload.status).toBe('fulfilled')
  })

  it('el espejo se busca por cuenta, tienda y número de pedido', async () => {
    await POST(actualizacion('partially_refunded'))

    expect(busqueda()?.filtros).toEqual([
      ['workspace_id', 'ws1'],
      ['shop_domain', 'tienda.myshopify.com'],
      ['shopify_order_id', '8811'],
    ])
    // Y el parche va a ESA fila, no a un filtro por dominio: dos tiendas
    // pueden repetir número de pedido.
    expect(espejo()?.filtros).toEqual([['id', 'ord1']])
  })

  it('publica la guía y el estado logístico cuando Shopify los cambia', async () => {
    await POST(
      actualizacion('paid', {
        fulfillment_status: 'fulfilled',
        fulfillments: [
          {
            shipment_status: 'in_transit',
            tracking_number: 'CO123456789',
            tracking_company: 'Coordinadora',
            tracking_url: 'https://rastreo.example/CO123456789',
          },
        ],
      }),
    )

    expect(emittedWebhooks.map((event) => event.type)).toEqual([
      'order.updated',
      'shipment.updated',
      'tracking.updated',
    ])
    expect(emittedWebhooks.at(-1)?.data.tracking_number).toBe('CO123456789')
  })

  it('no repite eventos logísticos cuando la guía no cambió', async () => {
    filaExistente = {
      id: 'ord1',
      tracking_number: 'CO123456789',
      tracking_company: 'Coordinadora',
      tracking_url: 'https://rastreo.example/CO123456789',
    }
    estadoFulfillment = {
      fulfillment_status: 'fulfilled',
      shipment_status: 'in_transit',
    }

    await POST(
      actualizacion('paid', {
        fulfillment_status: 'fulfilled',
        fulfillments: [
          {
            shipment_status: 'in_transit',
            tracking_number: 'CO123456789',
            tracking_company: 'Coordinadora',
            tracking_url: 'https://rastreo.example/CO123456789',
          },
        ],
      }),
    )

    expect(emittedWebhooks.map((event) => event.type)).toEqual(['order.updated'])
  })

  it('publica una novedad oficial una sola vez cuando Dropi la refleja en Shopify', async () => {
    filaExistente = { id: 'ord1', shop_tags: 'Confirmado' }

    await POST(
      actualizacion('paid', {
        tags: 'Confirmado, NOVEDAD: Dirección incompleta',
      }),
    )

    expect(emittedWebhooks.map((event) => event.type)).toEqual([
      'order.updated',
      'delivery.incident.opened',
    ])
    expect(emittedWebhooks.at(-1)?.data.incident_reason).toBe(
      'Dirección incompleta',
    )
  })

  it('no publica una novedad nueva de un pedido ya cancelado', async () => {
    filaExistente = { id: 'ord1', shop_tags: 'Confirmado' }

    await POST(
      actualizacion('paid', {
        tags: 'NOVEDAD: Destinatario ausente',
        cancelled_at: '2026-09-28T15:00:00.000Z',
      }),
    )

    expect(emittedWebhooks.map((event) => event.type)).toEqual(['order.updated'])
  })

  /**
   * La venta que hizo una persona sola en la tienda.
   *
   * No tiene fila espejo porque no la creó la IA. Antes el webhook sólo hacía
   * UPDATE, así que no matcheaba nada y la venta no quedaba registrada en
   * ningún lado. Ahora se crea, y marcada `sync`: decir que la hizo la IA
   * inflaría la atribución con ventas que no son suyas.
   */
  it('un pedido que no existía se crea, y no se lo anota a la IA', async () => {
    filaExistente = null
    await POST(actualizacion('paid'))

    const nueva = espejo()
    expect(nueva?.op).toBe('upsert')
    expect(nueva?.payload.created_by).toBe('sync')
    expect(nueva?.payload.shopify_order_id).toBe('8811')
    expect(nueva?.payload.financial_status).toBe('paid')
  })
})
