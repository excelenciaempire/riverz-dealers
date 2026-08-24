import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * En el chat web, el correo lo escribe el visitante.
 *
 * La ruta que lo guarda ya lo dice: «acá el dato es una AFIRMACIÓN de alguien
 * anónimo», y por eso no fusiona contactos. Pero el pedido se buscaba con ese
 * mismo correo como prueba de pertenencia, así que la fuga por número de pedido
 * seguía viva en dos pasos: escribir el correo de otra clienta, y después pedir
 * su pedido por número.
 *
 * En WhatsApp o Instagram es distinto: ahí el número o el id de la cuenta los
 * puso el canal, no la persona.
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

import { runTool } from './tools'

const base = {
  shopDomain: 'demo.myshopify.com',
  accessToken: 'tok',
  apiVersion: '2025-10',
  workspaceId: 'w1',
  contactId: 'c1',
  agentId: 'a1',
  conversationId: 'conv1',
  // El correo de OTRA clienta, escrito por el visitante.
  customerEmail: 'carla@example.com',
  customerPhone: undefined,
}

function baseVacia() {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'or']) q[m] = () => q
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
  return { db: { from: () => q } as never, workspaceId: 'w1', contactId: 'c1' }
}

describe('quién puede probar que el pedido es suyo', () => {
  let pedidas: string[] = []
  beforeEach(() => {
    pedidas = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        pedidas.push(String(url))
        return new Response(JSON.stringify({ orders: [] }), { status: 200 })
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('en el chat web no usa el correo escrito como prueba', async () => {
    await runTool(
      'lookup_order',
      { order_number: '1042' },
      { ...base, channel: 'webchat' } as never,
      null,
      { ...baseVacia(), channel: 'webchat' } as never,
    )
    // Sin identidad probada, la búsqueda por cliente ni se intenta: sólo queda
    // la del número, cuyo resultado se descarta si no es de esta persona.
    expect(pedidas.some((u) => u.includes('customers/search'))).toBe(false)
  })

  it('en WhatsApp sí, porque el número lo puso el canal', async () => {
    await runTool(
      'lookup_order',
      { order_number: '1042' },
      { ...base, channel: 'whatsapp', customerPhone: '+573105554433' } as never,
      null,
      { ...baseVacia(), channel: 'whatsapp' } as never,
    )
    expect(pedidas.some((u) => u.includes('customers/search'))).toBe(true)
  })
})
