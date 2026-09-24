import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { leerSuscripcion } = vi.hoisted(() => ({ leerSuscripcion: vi.fn() }))
vi.mock('./plan', () => ({ leerSuscripcion }))
vi.mock('./uso', () => ({ periodoDe: () => ({ desde: new Date('2026-09-01'), hasta: new Date('2026-10-01') }) }))

import { puedeAtenderContacto } from './contact-cap'

function base(rows: { objetivo?: { id: string; unified_contact_id: string | null }; unidos?: string[]; servido?: boolean; total?: number }) {
  let contacts = 0
  const calls: string[] = []
  const db = {
    from(table: string) {
      calls.push(table)
      if (table === 'contacts') {
        contacts++
        const result = contacts === 1
          ? { data: rows.objetivo ?? { id: 'c1', unified_contact_id: null }, error: null }
          : { data: (rows.unidos ?? []).map((id) => ({ id })), error: null }
        const q = {
          select: () => q, eq: () => q,
          maybeSingle: async () => result,
          then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
        }
        return q
      }
      const result = { data: rows.servido ? { reply_id: 'r1' } : null, error: null }
      const q = {
        select: () => q, eq: () => q, in: () => q, gte: () => q, lt: () => q,
        limit: () => q, maybeSingle: async () => result,
      }
      return q
    },
    rpc: vi.fn(async () => ({ data: rows.total ?? 0, error: null })),
  }
  return { db: db as unknown as SupabaseClient, calls }
}

describe('límite de contactos de IA', () => {
  beforeEach(() => {
    leerSuscripcion.mockReset()
    leerSuscripcion.mockResolvedValue({
      modeloCobro: 'oficial', estado: 'activa', incluidas: 500,
      periodoDesde: '2026-09-01', periodoHasta: '2026-10-01',
    })
  })

  it('deja continuar a un contacto ya atendido aunque el cupo esté lleno', async () => {
    const { db } = base({ servido: true, total: 500 })
    expect(await puedeAtenderContacto(db, 'w1', 'c1')).toBe(true)
  })

  it('bloquea un contacto nuevo al llegar al cupo', async () => {
    const { db } = base({ servido: false, total: 500 })
    expect(await puedeAtenderContacto(db, 'w1', 'c1')).toBe(false)
  })

  it('permite el contacto nuevo antes del límite y respeta cortesías', async () => {
    const { db } = base({ servido: false, total: 499 })
    expect(await puedeAtenderContacto(db, 'w1', 'c1')).toBe(true)
    leerSuscripcion.mockResolvedValueOnce({ modeloCobro: 'oficial', estado: 'cortesia', incluidas: 500 })
    const courtesy = base({})
    expect(await puedeAtenderContacto(courtesy.db, 'w1', 'c1')).toBe(true)
    expect(courtesy.calls).toEqual([])
  })
})
