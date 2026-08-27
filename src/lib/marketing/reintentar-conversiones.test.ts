import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reintentarConversiones } from './reintentar-conversiones'

/**
 * El barrido que vuelve a mandar lo que no salió.
 *
 * Todo lo de acá falla en silencio si se rompe: la fila queda en rojo y nadie
 * mira `conversion_events`. Lo que se prueba es que no reintente de más (Meta
 * descarta lo viejo, y un token roto falla igual la vez mil) ni de menos (una
 * venta que se puede recuperar y no se recupera es plata).
 */

const enviados: string[] = []
/** Qué contesta Meta en cada prueba. */
let respuesta: { ok: boolean; motivo?: string } = { ok: true }

vi.mock('./meta-conversions', () => ({
  reenviarEvento: async (_db: unknown, f: { event_id: string }) => {
    if (respuesta.ok) enviados.push(f.event_id)
    return respuesta
  },
}))

const AHORA = Date.parse('2026-08-27T12:00:00Z')
const hace = (ms: number) => new Date(AHORA - ms).toISOString()
const MIN = 60_000

/** Lo que el filtro de la consulta dejó pasar; el resto lo decide el código. */
function db(filas: unknown[]): SupabaseClient {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'neq', 'lt', 'gt', 'order']) c[m] = () => c
  c.limit = async () => ({ data: filas, error: null })
  return { from: () => c } as unknown as SupabaseClient
}

const fila = (p: Partial<Record<string, unknown>> = {}) => ({
  id: 'e1',
  workspace_id: 'w1',
  event_name: 'Purchase',
  event_id: '1001',
  payload: { data: [{ event_name: 'Purchase' }] },
  intentos: 1,
  sent_at: hace(60 * MIN),
  created_at: hace(60 * MIN),
  ...p,
})

beforeEach(() => {
  enviados.length = 0
  respuesta = { ok: true }
})

describe('el reintento', () => {
  it('reenvía lo que ya cumplió su espera', async () => {
    const r = await reintentarConversiones(db([fila()]), AHORA)
    expect(enviados).toEqual(['1001'])
    expect(r.enviados).toBe(1)
  })

  it('respeta la espera creciente y no vuelve a intentar antes de tiempo', async () => {
    // Segundo intento: la espera es de 30 min y sólo pasaron 20.
    const r = await reintentarConversiones(
      db([fila({ intentos: 2, sent_at: hace(20 * MIN) })]),
      AHORA,
    )
    expect(enviados).toEqual([])
    expect(r.enviados).toBe(0)
  })

  it('la espera se cuenta desde el último intento, no desde la venta', async () => {
    // Venta de hace tres días, reintentada hace cinco minutos: no toca.
    const r = await reintentarConversiones(
      db([fila({ intentos: 1, created_at: hace(3 * 24 * 60 * MIN), sent_at: hace(5 * MIN) })]),
      AHORA,
    )
    expect(enviados).toEqual([])
    expect(r.enviados).toBe(0)
  })

  it('sin píxel no gasta un intento', async () => {
    // El comercio lo desconectó después de la venta. Si lo reconecta, esta
    // venta todavía tiene que poder contarse.
    respuesta = { ok: false, motivo: 'sin_pixel' }
    const r = await reintentarConversiones(db([fila()]), AHORA)
    expect(r.fallidos).toBe(0)
    expect(r.rendidos).toBe(0)
  })

  it('el quinto fallo se da por rendido', async () => {
    // El tope es 5: una fila con 4 intentos todavía entra, y ese quinto fallo
    // es el último. Sin esto, un token ilegible se reintenta para siempre.
    respuesta = { ok: false, motivo: 'http_400' }
    const r = await reintentarConversiones(
      db([fila({ intentos: 4, sent_at: hace(600 * MIN) })]),
      AHORA,
    )
    expect(r.fallidos).toBe(1)
    expect(r.rendidos).toBe(1)
  })

  it('un fallo que todavía tiene intentos por delante no se da por rendido', async () => {
    respuesta = { ok: false, motivo: 'http_500' }
    const r = await reintentarConversiones(db([fila({ intentos: 1 })]), AHORA)
    expect(r.fallidos).toBe(1)
    expect(r.rendidos).toBe(0)
  })
})
