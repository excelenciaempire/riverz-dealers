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
  payload: Record<string, unknown>
  filtros: Array<[string, unknown]>
}

const escrituras: Escritura[] = []

function fakeAdmin() {
  return {
    from(table: string) {
      const estado = {
        payload: {} as Record<string, unknown>,
        filtros: [] as Array<[string, unknown]>,
        anotar: false,
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        is: () => chain,
        in: () => chain,
        neq: () => chain,
        insert: () => chain,
        upsert: () => chain,
        update(payload: Record<string, unknown>) {
          estado.payload = payload
          estado.anotar = true
          return chain
        },
        eq(col: string, val: unknown) {
          estado.filtros.push([col, val])
          return chain
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => {
          if (estado.anotar) {
            escrituras.push({ table, payload: estado.payload, filtros: estado.filtros })
            estado.anotar = false
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
vi.mock('@/lib/voice/auto-enqueue', () => ({ maybeAutoVoiceCall: async () => {} }))
vi.mock('@/lib/contacts/tags', () => ({ applyCategoryTags: async () => {} }))
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => 'ws1' }))
vi.mock('@/lib/webhooks/capture', () => ({ captureWebhookFailure: async () => {} }))
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

const espejo = () => escrituras.find((e) => e.table === 'orders')

beforeEach(() => {
  escrituras.length = 0
})

describe('POST /api/shopify/webhooks/orders — espejo de estados', () => {
  it('un reembolso parcial no cancela el pedido', async () => {
    await POST(actualizacion('partially_refunded'))

    const upd = espejo()
    expect(upd).toBeTruthy()
    expect(upd?.payload.financial_status).toBe('partially_refunded')
    // Lo único que se mueve es el estado de pago: sin esto el pedido salía de
    // los ingresos entero y desaparecía del buscador de posventa.
    expect(upd?.payload).not.toHaveProperty('status')
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

  it('el espejo se busca por tienda y número de pedido', async () => {
    await POST(actualizacion('partially_refunded'))

    expect(espejo()?.filtros).toEqual([
      ['shop_domain', 'tienda.myshopify.com'],
      ['shopify_order_id', '8811'],
    ])
  })
})
