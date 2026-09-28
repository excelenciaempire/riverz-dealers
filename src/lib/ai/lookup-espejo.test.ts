import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * El pedido que el agente acaba de crear, cuando preguntan por él.
 *
 * Shopify sólo devuelve los pedidos que puede ATRIBUIR a la persona por
 * teléfono o correo, y quien escribe por el chat web no tiene ninguno de los
 * dos hasta que se identifica. Así que a "¿dónde está mi pedido #1002?" el
 * agente contestaba "no se encontró ningún pedido" — sobre uno que él mismo
 * había creado dos minutos antes en esa misma conversación.
 *
 * La fila espejo sí sabe de quién es: está atada al contacto. Esa atadura es
 * también lo que la hace segura como respuesta.
 */

vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'update', 'is', 'order', 'limit']) q[m] = () => q
      q.maybeSingle = async () => ({ data: null, error: null })
      return q
    },
  }),
}))

import { LOOKUP_ORDER_TOOL, runTool } from './tools'

const shopify = {
  shopDomain: 'demo.myshopify.com',
  accessToken: 'tok',
  apiVersion: '2025-10',
  workspaceId: 'w1',
  contactId: 'c1',
  agentId: 'a1',
  conversationId: 'conv1',
  channel: 'webchat',
  // El chat web sin identificar: ni teléfono ni correo con qué atribuir.
  customerPhone: undefined,
  customerEmail: undefined,
}

/** Una base que sólo sabe devolver las filas que le pasen. */
function baseCon(filas: Array<Record<string, unknown>>) {
  const usados: string[] = []
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q
  q.or = (f: string) => {
    usados.push(f)
    return q
  }
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: filas, error: null })
  return {
    db: { from: () => q } as never,
    workspaceId: 'w1',
    contactId: 'c1',
    usados,
  }
}

describe('lookup_order en el chat web', () => {
  beforeEach(() => {
    // Shopify no le atribuye ningún pedido a un visitante anónimo.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ orders: [] }), { status: 200 })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('contesta con la fila espejo cuando Shopify no atribuye nada', async () => {
    const local = baseCon([
      { order_number: '#1002', currency: 'USD', total_price: '699.95', status: 'created', contact_id: 'c1' },
    ])
    const salida = JSON.parse(
      await runTool('lookup_order', { order_number: '#1002' }, shopify as never, null, local as never),
    )
    expect(salida.found).toBe(true)
    expect(salida.orders[0].order_number).toBe('#1002')
  })

  it('enriches the same customer order with Dropi without exposing buyer history', async () => {
    const now = new Date().toISOString()
    const local = baseCon([{ order_number: '#1002', contact_id: 'c1', dropi_observed_at: now,
      dropi_evidence: { account_id: '1', shop_id: '2', dropi_order_id: '3', status: 'NOVEDAD',
        tracking_number: '123', incident_reason: 'DESTINATARIO AUSENTE', total: '110000',
        product_cost: '50000', shipping_cost: '10000', wallet_net: null, currency: 'COP',
        buyer_history: { classification: 'risky', buyer_type: 'Frecuente', total: 25,
          delivered: 3, returned: 21, in_transit: 1, observed_at: now, source: 'dropi_fingerprint_v2' } } }])
    const result = JSON.parse(await runTool('lookup_order', { order_number: '#1002' }, shopify as never, null, local as never))
    expect(result.orders).toHaveLength(1)
    expect(result.orders[0].dropi.incident_reason).toBe('DESTINATARIO AUSENTE')
    expect(result.orders[0].dropi.buyer_classification).toBe('risky')
    expect(result.orders[0].dropi).not.toHaveProperty('buyer_history')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('busca ese número con y sin almohadilla', async () => {
    const local = baseCon([{ order_number: '#1002' }])
    await runTool('lookup_order', { order_number: '1002' }, shopify as never, null, local as never)
    expect(local.usados.join(' ')).toContain('order_number.eq."#1002"')
  })

  it('sin pedido espejado sigue diciendo que no lo encontró', async () => {
    const local = baseCon([])
    const salida = JSON.parse(
      await runTool('lookup_order', { order_number: '#9999' }, shopify as never, null, local as never),
    )
    expect(salida.found).toBe(false)
    // Y el aviso de no inventar tiene que seguir viajando con la respuesta
    // vacía: es lo único que evita que "found:false" se parafrasee como
    // "tu pedido está en camino".
    expect(salida.instruction).toContain('NO inventes')
    expect(salida.instruction).toContain('Falta verificar la identidad')
    expect(salida.instruction).toContain('ni afirmes que no existe')
  })
})

describe('lookup_order distingue los datos del cliente', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('expone campos separados para pedido, teléfono y correo', () => {
    const properties = LOOKUP_ORDER_TOOL.input_schema.properties as Record<string, unknown>
    expect(properties).toHaveProperty('order_number')
    expect(properties).toHaveProperty('customer_phone')
    expect(properties).toHaveProperty('customer_email')
  })

  it('corrige un celular colombiano enviado por error como número de pedido', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ customers: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const local = baseCon([])
    const salida = JSON.parse(
      await runTool(
        'lookup_order',
        { order_number: '3003364305' },
        { ...shopify, channel: 'messenger' } as never,
        null,
        local as never
      )
    )

    // Se busca como teléfono —primero tal cual, después en otras formas— y
    // nunca como número de pedido.
    const urls = fetchMock.mock.calls.map((c) => decodeURIComponent(String(c[0])))
    expect(urls[0]).toContain('/customers/search.json')
    expect(urls[0]).toContain('query=phone:3003364305')
    expect(urls.some((u) => u.includes('/orders.json'))).toBe(false)
    expect(salida.searched_by).toBe('phone')
    expect(salida.instruction).toContain('ese teléfono')
    expect(salida.instruction).toContain('no vuelvas a pedirle el mismo dato')
  })

  it('busca un correo confirmado como correo, no como pedido', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ customers: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const salida = JSON.parse(
      await runTool(
        'lookup_order',
        { customer_email: 'cliente@example.com' },
        { ...shopify, channel: 'instagram' } as never,
        null,
        baseCon([]) as never
      )
    )

    const url = decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]))
    expect(url).toContain('query=email:cliente@example.com')
    expect(salida.searched_by).toBe('email')
    expect(salida.instruction).toContain('ese correo')
  })

  it('a simulation without a contact id searches by email without an invalid UUID filter', async () => {
    const local = baseCon([{order_number:'#1673', customer_email:'buyer@example.com'}])
    local.contactId = ''
    const result = JSON.parse(await runTool('lookup_order', {customer_email:'buyer@example.com'}, null, null, local as never))
    expect(result.found).toBe(true)
    expect(local.usados.join(',')).toContain('customer_email.ilike.buyer@example.com')
    expect(local.usados.join(',')).not.toContain('contact_id.eq.')
  })

  it('no toma como prueba un teléfono declarado en el chat web anónimo', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const salida = JSON.parse(
      await runTool('lookup_order', { customer_phone: '3003364305' }, shopify as never, null, baseCon([]) as never)
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(salida.searched_by).toBe('none')
  })
})
