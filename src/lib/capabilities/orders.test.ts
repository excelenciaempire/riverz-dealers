import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lo que estas pruebas cuidan.
 *
 * 1. Que la cuenta salga del contexto y nunca de los argumentos. El contacto
 *    llega por id, y un id de otro comercio tiene que dar "no existe" — si el
 *    recorte por `workspace_id` se cayera, alcanzaría con un uuid ajeno para
 *    crearle un pedido a la clienta de otra tienda.
 * 2. Que el `preview` no ejecute. Es la única defensa real de las tres
 *    capacidades irreversibles: si cotizar creara el pedido, "mostrame qué
 *    harías" ya lo habría hecho.
 * 3. Que el preview de un pago informado diga cuál de las dos ramas toca.
 *    Cobrar en Shopify y preguntarle al dueño son cosas muy distintas, y quien
 *    aprueba decide mirando ese texto.
 * 4. Que el pedido quede reflejado en Riverz con el contacto y con la marca de
 *    que lo confirmó una persona, no el bot.
 */

const WS = '11111111-1111-1111-1111-111111111111'
const OTRA = '99999999-9999-9999-9999-999999999999'
const ANA = '22222222-2222-2222-2222-222222222222'

const resolveShopifyContext = vi.fn()
const createCheckoutLink = vi.fn()
const crearPedidoConEspejo = vi.fn()
const informarPago = vi.fn()
const pendingOrderFor = vi.fn()

vi.mock('@/lib/ai/runner', () => ({
  resolveShopifyContext: (...args: unknown[]) => resolveShopifyContext(...args),
}))

vi.mock('@/lib/products/currency', () => ({
  resolveWorkspaceCurrency: async () => 'ARS',
}))

// Parcial a propósito: `fmtMoney` es el formato real que va a leer una persona
// en el preview, y cambiarlo por un doble haría pasar la prueba con un texto
// que en producción sale distinto.
vi.mock('@/lib/shopify/create-checkout', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/lib/shopify/create-checkout')>()
  return { ...real, createCheckoutLink: (...a: unknown[]) => createCheckoutLink(...a) }
})

vi.mock('@/lib/orders/crear', () => ({
  crearPedidoConEspejo: (...a: unknown[]) => crearPedidoConEspejo(...a),
}))

// También parcial: `montoCoincide` es la cuenta que decide la rama, y es
// justamente lo que el preview tiene que anticipar sin equivocarse.
vi.mock('@/lib/payments/reported-payment', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/lib/payments/reported-payment')>()
  return {
    ...real,
    informarPago: (...a: unknown[]) => informarPago(...a),
    pendingOrderFor: (...a: unknown[]) => pendingOrderFor(...a),
  }
})

import { ORDER_CAPABILITIES } from './orders'
import type { Capability, CapabilityContext } from './types'

function cap(key: string): Capability {
  const c = ORDER_CAPABILITIES.find((x) => x.key === key)
  if (!c) throw new Error(`falta la capacidad ${key}`)
  return c
}

interface ContactoFalso {
  id: string
  workspace_id: string
  name: string | null
  phone: string | null
  email: string | null
  channel: string | null
}

const CONTACTOS: ContactoFalso[] = [
  {
    id: ANA,
    workspace_id: WS,
    name: 'Ana Pérez',
    phone: '+5491133334444',
    email: 'ana@example.com',
    channel: 'whatsapp',
  },
]

/** Sólo devuelve el contacto si el filtro trae la cuenta correcta. */
function fakeDb(contactos = CONTACTOS): SupabaseClient {
  const api = {
    from() {
      const filtros: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        eq(columna: string, valor: unknown) {
          filtros[columna] = valor
          return chain
        },
        maybeSingle: async () => ({
          data:
            contactos.find(
              (c) =>
                (filtros.id === undefined || c.id === filtros.id) &&
                (filtros.workspace_id === undefined ||
                  c.workspace_id === filtros.workspace_id),
            ) ?? null,
          error: null,
        }),
      })
      return chain
    },
  }
  return api as unknown as SupabaseClient
}

function ctx(db: SupabaseClient = fakeDb()): CapabilityContext {
  return { db, workspaceId: WS, actor: { type: 'operator', id: 'u1' } }
}

const TIENDA = {
  shopDomain: 'pilar.myshopify.com',
  accessToken: 'shpat_x',
  apiVersion: '2026-01',
  pinnedVariantId: '777',
  storefrontDomain: null,
  config: null,
}

const COTIZACION = {
  checkout_url: 'https://pilar.store/cart/777:3',
  offer_label: '3 unidades',
  total_label: '$69.900',
  payment_label: 'Podés pagar con tarjeta.',
  next_step_for_pili: 'Mandale el link.',
}

beforeEach(() => {
  resolveShopifyContext.mockResolvedValue(TIENDA)
  createCheckoutLink.mockResolvedValue(COTIZACION)
  crearPedidoConEspejo.mockResolvedValue({
    shopify_order_id: '5001',
    order_number: '#1042',
    order_status_url: 'https://pilar.store/1042',
    currency: 'ARS',
    total_price: 69900,
    line_items: [],
    customer_name: 'Ana Pérez',
    customer_phone: '+5491133334444',
    customer_email: 'ana@example.com',
    shipping_address: null,
    payment_method: 'card_or_mp',
    offer_label: '3 unidades',
    next_step_for_pili: '',
  })
})

describe('la cuenta manda, no los argumentos', () => {
  it('un contacto de otro comercio no existe', async () => {
    const ajeno = [{ ...CONTACTOS[0], workspace_id: OTRA }]
    await expect(
      cap('pedidos.crear').run(ctx(fakeDb(ajeno)), { contacto_id: ANA }),
    ).rejects.toThrow(/no existe en esta cuenta/)
    expect(crearPedidoConEspejo).not.toHaveBeenCalled()
  })

  it('ninguna de las que mueven dinero pide workspace_id', () => {
    for (const key of ['pedidos.checkout', 'pedidos.crear', 'pedidos.registrar_pago']) {
      expect(Object.keys(cap(key).schema.properties), key).not.toContain('workspace_id')
    }
  })

  it('las tres que mueven dinero son irreversibles y explican qué harían', () => {
    for (const key of ['pedidos.checkout', 'pedidos.crear', 'pedidos.registrar_pago']) {
      expect(cap(key).risk, key).toBe('irreversible')
      expect(typeof cap(key).preview, key).toBe('function')
    }
  })
})

describe('sin tienda conectada', () => {
  it('corta con el motivo en vez de dejar el pedido a medias', async () => {
    resolveShopifyContext.mockResolvedValue(null)
    await expect(
      cap('pedidos.crear').run(ctx(), { contacto_id: ANA }),
    ).rejects.toThrow(/Shopify/)
    expect(crearPedidoConEspejo).not.toHaveBeenCalled()
  })
})

describe('link de pago', () => {
  it('devuelve el link y NO crea ningún pedido', async () => {
    const r = (await cap('pedidos.checkout').run(ctx(), {
      contacto_id: ANA,
      cantidad: 3,
    })) as Record<string, unknown>
    expect(r.link).toBe(COTIZACION.checkout_url)
    expect(r.total).toBe('$69.900')
    expect(crearPedidoConEspejo).not.toHaveBeenCalled()
  })

  it('el preview nombra a la persona y el monto real', async () => {
    const texto = await cap('pedidos.checkout').preview!(ctx(), {
      contacto_id: ANA,
      cantidad: 3,
    })
    expect(texto).toContain('Ana Pérez')
    expect(texto).toContain('$69.900')
  })

  it('sin stock lo dice antes de que alguien apruebe', async () => {
    createCheckoutLink.mockResolvedValue({
      error: 'out_of_stock',
      message: 'No hay stock suficiente para 3 unidades (quedan 1).',
    })
    const texto = await cap('pedidos.checkout').preview!(ctx(), {
      contacto_id: ANA,
      cantidad: 3,
    })
    expect(texto).toMatch(/No hay stock/)
  })
})

describe('crear el pedido', () => {
  it('el preview cotiza pero no crea nada', async () => {
    const texto = await cap('pedidos.crear').preview!(ctx(), {
      contacto_id: ANA,
      cantidad: 3,
      direccion: { address1: 'Corrientes 1234', city: 'CABA' },
    })
    expect(texto).toContain('$69.900')
    expect(texto).toContain('Corrientes 1234')
    expect(crearPedidoConEspejo).not.toHaveBeenCalled()
  })

  it('avisa cuando iría sin dirección de envío', async () => {
    const texto = await cap('pedidos.crear').preview!(ctx(), { contacto_id: ANA })
    expect(texto).toContain('SIN dirección')
  })

  it('usa el nombre del contacto y lo marca como confirmado por una persona', async () => {
    await cap('pedidos.crear').run(ctx(), { contacto_id: ANA, cantidad: 3 })
    const [entrada, tienda, espejo] = crearPedidoConEspejo.mock.calls[0]
    expect((entrada as { customer_name: string }).customer_name).toBe('Ana Pérez')
    expect((tienda as { shopDomain: string }).shopDomain).toBe('pilar.myshopify.com')
    expect(espejo).toMatchObject({
      workspaceId: WS,
      contactId: ANA,
      channel: 'whatsapp',
      createdBy: 'manual',
    })
  })

  it('sin nombre en ningún lado no inventa uno', async () => {
    const anonimo = [{ ...CONTACTOS[0], name: null }]
    await expect(
      cap('pedidos.crear').run(ctx(fakeDb(anonimo)), { contacto_id: ANA }),
    ).rejects.toThrow(/nombre/)
    expect(crearPedidoConEspejo).not.toHaveBeenCalled()
  })
})

describe('pago informado', () => {
  const PENDIENTE = {
    id: 'o1',
    orderNumber: '#1042',
    total: '69900',
    currency: 'ARS',
    shopifyOrderId: '5001',
  }

  it('con el monto exacto anticipa que lo va a cobrar', async () => {
    pendingOrderFor.mockResolvedValue(PENDIENTE)
    const texto = await cap('pedidos.registrar_pago').preview!(ctx(), {
      contacto_id: ANA,
      monto: 69900,
    })
    expect(texto).toContain('PAGADO')
    expect(texto).toContain('$69.900')
  })

  it('sin monto anticipa que va a preguntar', async () => {
    pendingOrderFor.mockResolvedValue(PENDIENTE)
    const texto = await cap('pedidos.registrar_pago').preview!(ctx(), {
      contacto_id: ANA,
    })
    expect(texto).toContain('NO lo daría por cobrado')
  })

  it('con un monto que no cierra tampoco promete el cobro', async () => {
    pendingOrderFor.mockResolvedValue(PENDIENTE)
    const texto = await cap('pedidos.registrar_pago').preview!(ctx(), {
      contacto_id: ANA,
      monto: 1000,
    })
    expect(texto).toContain('NO lo daría por cobrado')
    expect(texto).toContain('$1.000')
  })

  it('sin pedido pendiente lo dice en vez de fallar', async () => {
    pendingOrderFor.mockResolvedValue(null)
    const texto = await cap('pedidos.registrar_pago').preview!(ctx(), {
      contacto_id: ANA,
    })
    expect(texto).toMatch(/no tiene ningún pedido pendiente/)
  })

  it('cuando queda a confirmar devuelve el estado sin decir que está pago', async () => {
    informarPago.mockResolvedValue({
      resultado: { kind: 'a_confirmar', reason: 'no se pudo leer el monto' },
      pedido: PENDIENTE,
    })
    const r = (await cap('pedidos.registrar_pago').run(ctx(), {
      contacto_id: ANA,
    })) as Record<string, unknown>
    expect(r.estado).toBe('en_verificacion')
    expect(r.pedido).toBe('#1042')
  })
})
