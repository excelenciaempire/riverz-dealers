/* eslint-disable @typescript-eslint/no-explicit-any -- dobles de los módulos del camino en vivo */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({
  encendido: true,
  ajustes: {
    audience: 'intent',
    maxThreadReplies: 3,
    replyMode: 'public_smart',
    publicReply: true,
    instagram: true,
    facebook: true,
    tiktok: false,
  } as Record<string, unknown>,
  puedeIa: true,
  clasificacion: { spam: false, score: 'high', sentiment: 'neutral' } as Record<string, unknown>,
  respuesta: 'Sí, sirve para entradas y coronilla. El tratamiento de 4 meses sale $61.990.',
  decision: { dm: true, reason: 'compra' } as { dm: boolean; reason: string },
  producto: { brief: 'PRODUCTO', authorizedPriceValues: [61990], pricingVerified: true } as any,
  requiereAprobacion: false,
  simulada: vi.fn(),
}))

vi.mock('@/lib/ai/platform-key', () => ({ resolveAnthropicKey: async () => ({ key: 'k', source: 'platform' }) }))
vi.mock('@/lib/wallet/puerta', () => ({ puedeUsarIa: async () => s.puedeIa }))
vi.mock('./controls', () => ({
  autoReplyCommentsEnabled: async () => s.encendido,
  loadCommentSettings: async () => s.ajustes,
}))
vi.mock('./lead-scoring', () => ({ scoreLeads: async () => [s.clasificacion] }))
vi.mock('./agent-link', () => ({
  resolveIgAgent: async () => ({ id: 'ag', escalate_keywords: ['humano'] }),
  commentAgentCanReply: (_a: unknown, t: string) => !t.includes('humano'),
}))
vi.mock('./brand-context', () => ({ loadBrandContext: async () => ({ language: 'es' }) }))
vi.mock('./store-links', () => ({ loadStoreLinks: async () => ({ storeUrl: null, products: [] }) }))
vi.mock('./product-brain', () => ({ loadProductBrain: async () => s.producto }))
vi.mock('./dm-opportunity', () => ({ decideCommentDm: async () => s.decision }))
vi.mock('@/lib/ai/simulacion', () => ({
  simularRespuesta: async (...args: unknown[]) => {
    s.simulada(...args)
    return { reply: s.respuesta, chunks: [s.respuesta], herramientas: [], usage: {} }
  },
}))

import { simularComentario } from './simulacion-comentario'

const db = {
  from: () => ({
    select: () => ({
      eq: () => ({
        is: () => ({
          maybeSingle: async () => ({
            data: { id: 'ag', name: 'Natalia', requires_approval: s.requiereAprobacion },
          }),
        }),
      }),
    }),
  }),
} as any

const comentar = (texto: string, canal: 'ig_comment' | 'fb_comment' = 'ig_comment') =>
  simularComentario(db, { workspaceId: 'w', canal, texto, historial: [] })

describe('simularComentario — el mismo camino que Comentarios en vivo', () => {
  beforeEach(() => {
    s.encendido = true
    s.ajustes = { ...s.ajustes, audience: 'intent', maxThreadReplies: 3, replyMode: 'public_smart', publicReply: true, instagram: true, facebook: true }
    s.puedeIa = true
    s.clasificacion = { spam: false, score: 'high', sentiment: 'neutral' }
    s.respuesta = 'Sí, sirve para entradas y coronilla. El tratamiento de 4 meses sale $61.990.'
    s.decision = { dm: true, reason: 'compra' }
    s.producto = { brief: 'PRODUCTO', authorizedPriceValues: [61990], pricingVerified: true }
    s.requiereAprobacion = false
    s.simulada.mockClear()
  })

  it('con Comentarios apagado no sale nada', async () => {
    s.encendido = false
    expect((await comentar('¿Sirve para la coronilla?')).barrera).toEqual({ tipo: 'comment_apagado', detalle: null })
  })

  it('una red apagada tampoco contesta', async () => {
    s.ajustes = { ...s.ajustes, facebook: false }
    expect((await comentar('¿Sirve?', 'fb_comment')).barrera?.tipo).toBe('comment_red_apagada')
  })

  it('la crítica se oculta y no se contesta', async () => {
    const r = await comentar('Dejen de mentir, publicidad falsa')
    expect(r.oculto).toBe('critica')
    expect(r.publico).toBeNull()
    expect(s.simulada).not.toHaveBeenCalled()
  })

  it('el spam se oculta', async () => {
    s.clasificacion = { spam: true, score: 'low', sentiment: 'negative' }
    expect((await comentar('Seguime y ganá plata fácil')).oculto).toBe('spam')
  })

  it('sin intención de compra ni duda concreta no contesta', async () => {
    s.clasificacion = { spam: false, score: 'low', sentiment: 'neutral' }
    expect((await comentar('Jajaja mirá esto')).barrera?.tipo).toBe('comment_sin_intencion')
  })

  it('en "si hace falta" publica una línea y manda el resto por privado', async () => {
    const r = await comentar('¿Cuánto sale el de 4 meses?')
    expect(r.barrera).toBeNull()
    expect(r.publico).toContain('Te escribí por privado')
    expect(r.privado).toContain('Vi tu comentario')
    expect(r.privado).toContain('$61.990')
    expect(s.simulada).toHaveBeenCalledWith(db, expect.objectContaining({ id: 'ag' }), expect.objectContaining({ superficie: 'comentario', simulatedChannel: 'ig_comment' }))
  })

  it('sin privado, la respuesta entera va en el comentario', async () => {
    s.decision = { dm: false, reason: 'ninguna' }
    s.respuesta = 'Sí, también lo pueden usar mujeres.'
    const r = await comentar('¿Sólo para hombres?')
    expect(r.privado).toBeNull()
    expect(r.publico).toBe('Sí, también lo pueden usar mujeres.')
  })

  it('un precio que no está verificado no se publica', async () => {
    s.respuesta = 'Sale $55.000.'
    expect((await comentar('¿Precio?')).barrera).toEqual({ tipo: 'comment_precio_no_autorizado', detalle: '55000' })
  })

  it('quien pide una persona no recibe una venta', async () => {
    expect((await comentar('quiero hablar con un humano')).barrera?.tipo).toBe('comment_pide_humano')
  })

  it('un pago por fuera de la caja va por privado y queda para una persona', async () => {
    const r = await comentar('¿Me pasás el alias para transferir?')
    expect(r.escala).toBe('pago')
    expect(r.publico).toBe('Te escribí por privado para revisarlo contigo 💬')
  })

  it('con "Aprobar cada mensaje" queda propuesta', async () => {
    s.requiereAprobacion = true
    expect((await comentar('¿Cuánto sale el de 4 meses?')).esperaAprobacion).toBe(true)
  })

  it('sin poder usar la IA la clasificación no corre y se sigue con el nivel medio', async () => {
    s.puedeIa = false
    s.clasificacion = { spam: true, score: 'low', sentiment: 'negative' }
    const r = await comentar('¿Sirve para la coronilla?')
    expect(r.oculto).toBeNull()
    expect(r.publico).not.toBeNull()
  })
})
