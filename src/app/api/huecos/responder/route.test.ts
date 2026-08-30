import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * La respuesta que faltaba no siempre es de un producto.
 *
 * "Puedo retirar en sucursal?", "hacen factura A?", "cuanto tarda el envio?"
 * son politicas del NEGOCIO: no cambian de un producto a otro, y meterlas en
 * la ficha de uno las hace desaparecer cuando el cliente pregunta por otro.
 *
 * El formulario obligaba a elegir un producto, asi que el comercio elegia uno
 * al azar o se iba a otra pantalla a escribir la regla a mano. La mitad no lo
 * hacia, y la misma pregunta volvia a la semana — que es exactamente lo que
 * esta pantalla existe para evitar.
 */

const escrituras: Array<{ tabla: string; fila: Record<string, unknown> }> = []
let productoExiste = true

function tabla(nombre: string) {
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.eq = () => q
  q.is = () => q
  q.update = (fila: Record<string, unknown>) => {
    escrituras.push({ tabla: `${nombre}:update`, fila })
    return q
  }
  q.upsert = async (fila: Record<string, unknown>) => {
    escrituras.push({ tabla: `${nombre}:upsert`, fila })
    return { error: null }
  }
  q.maybeSingle = async () => ({
    data: nombre === 'shopify_products' && productoExiste
      ? { id: 'p1', custom_faqs: [] }
      : null,
    error: null,
  })
  q.then = (ok: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(ok)
  return q
}

vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({ from: (t: string) => tabla(t) }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
}))
vi.mock('@/lib/workspaces/resolve', () => ({
  resolveWorkspaceIdForUser: async () => 'ws1',
}))
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => null }))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }))
vi.mock('@/lib/products/write', () => ({
  actualizarProducto: async (_db: unknown, args: Record<string, unknown>) => {
    escrituras.push({ tabla: 'producto', fila: args })
    return { ok: true }
  },
}))

import { POST } from './route'

const pedir = (body: unknown) =>
  POST(
    new Request('https://riverz.co/api/huecos/responder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  escrituras.length = 0
  productoExiste = true
})

describe('dónde va la respuesta que faltaba', () => {
  it('una politica del negocio se guarda como REGLA, sin producto', async () => {
    const r = await pedir({
      key: 'puedo retirar en sucursal',
      destino: 'regla',
      question: '¿Puedo retirar en sucursal?',
      answer: 'No tenemos puntos de retiro. Se envía por Andreani al domicilio.',
    })
    expect(r.status).toBe(200)
    const regla = escrituras.find((e) => e.tabla === 'agent_guidance:upsert')
    expect(regla).toBeTruthy()
    expect(regla?.fila.workspace_id).toBe('ws1')
    // Vale para toda la cuenta, no para un agente ni un producto.
    expect(regla?.fila.agent_id).toBeNull()
    expect(regla?.fila.hacer).toContain('No tenemos puntos de retiro')
    // Y no toca ningún producto.
    expect(escrituras.find((e) => e.tabla === 'producto')).toBeUndefined()
  })

  it('responder dos veces la misma corrige la regla, no la duplica', async () => {
    await pedir({
      key: 'puedo retirar en sucursal',
      destino: 'regla',
      question: '¿Puedo retirar?',
      answer: 'No.',
    })
    const regla = escrituras.find((e) => e.tabla === 'agent_guidance:upsert')
    expect(String(regla?.fila.clave)).toBe('hueco_puedo retirar en sucursal')
  })

  it('sin destino sigue yendo al producto, como siempre', async () => {
    // Romper el comportamiento viejo al agregar el nuevo seria cambiarle el
    // significado a las llamadas que ya andan.
    const r = await pedir({
      key: 'sirve para piel sensible',
      product_id: 'p1',
      question: '¿Sirve para piel sensible?',
      answer: 'Sí, es apto.',
    })
    expect(r.status).toBe(200)
    expect(escrituras.find((e) => e.tabla === 'producto')).toBeTruthy()
    expect(escrituras.find((e) => e.tabla === 'agent_guidance:upsert')).toBeUndefined()
  })

  it('al producto sin producto sigue siendo un error', async () => {
    const r = await pedir({
      key: 'k',
      question: '¿Sirve?',
      answer: 'Sí.',
    })
    expect(r.status).toBe(400)
  })

  it('la regla NO se cierra si no se pudo guardar', async () => {
    // Al reves se perderia la pregunta y nadie sabria que falta.
    const r = await pedir({ key: 'k', destino: 'regla', question: '', answer: 'x' })
    expect(r.status).toBe(400)
    expect(escrituras).toHaveLength(0)
  })
})
