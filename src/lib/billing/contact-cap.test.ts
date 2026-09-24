import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { leerSuscripcion } = vi.hoisted(() => ({ leerSuscripcion: vi.fn() }))
vi.mock('./plan', () => ({ leerSuscripcion }))
vi.mock('./uso', () => ({ periodoDe: () => ({ desde: new Date('2026-09-01'), hasta: new Date('2026-10-01') }) }))

import { puedeAtenderContacto } from './contact-cap'

function base(permitido: boolean) {
  const rpc = vi.fn(async () => ({ data: permitido, error: null }))
  return { db: { rpc } as unknown as SupabaseClient, rpc }
}

describe('límite de contactos de IA', () => {
  beforeEach(() => {
    leerSuscripcion.mockReset()
    leerSuscripcion.mockResolvedValue({
      modeloCobro: 'oficial', estado: 'activa', incluidas: 500,
      periodoDesde: '2026-09-01', periodoHasta: '2026-10-01',
    })
  })

  it('reserva la identidad antes de admitir un contacto nuevo', async () => {
    const { db, rpc } = base(true)
    expect(await puedeAtenderContacto(db, 'w1', 'c1')).toBe(true)
    expect(rpc).toHaveBeenCalledWith('billing_try_reserve_contact', {
      p_workspace: 'w1', p_contact: 'c1', p_limite: 500,
      p_desde: '2026-09-01T00:00:00.000Z', p_hasta: '2026-10-01T00:00:00.000Z',
    })
  })

  it('bloquea un contacto nuevo cuando la reserva atómica lo deniega', async () => {
    const { db } = base(false)
    expect(await puedeAtenderContacto(db, 'w1', 'c1')).toBe(false)
  })

  it('no consume cupo en cortesías', async () => {
    leerSuscripcion.mockResolvedValueOnce({ modeloCobro: 'oficial', estado: 'cortesia', incluidas: 500 })
    const { db, rpc } = base(false)
    expect(await puedeAtenderContacto(db, 'w1', 'c1')).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })
})
