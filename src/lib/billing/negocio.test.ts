import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { leerNegocio } from './negocio'

function base(fallarWorkspaces = false) {
  const rows: Record<string, unknown[]> = {
    workspace_subscriptions: [],
    workspaces: [
      { id: 'w1', name: 'Tienda Nueva', owner_id: 'u1' },
      { id: 'w2', name: 'Otra Tienda', owner_id: 'u2' },
    ],
    profiles: [{ user_id: 'u1', email: 'cliente@example.com' }],
    billing_usage_daily: [],
    wallet_accounts: [],
    wallet_movimientos: [],
  }
  const from = vi.fn((table: string) => {
    const result = { data: rows[table] ?? [], error: table === 'workspaces' && fallarWorkspaces ? new Error('DB unavailable') : null }
    const q = {
      select: () => q, is: () => q, gte: () => q, lt: () => q,
      limit: () => q, in: () => q,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    return q
  })
  return { db: { from } as unknown as SupabaseClient, from }
}

describe('cuentas de Negocio', () => {
  const periodo = { desde: new Date('2026-09-01'), hasta: new Date('2026-10-01') }

  it('muestra los workspaces nuevos aun sin fila de suscripción', async () => {
    const { db } = base()
    const negocio = await leerNegocio(db, periodo)
    expect(negocio.cuentas).toHaveLength(2)
    expect(negocio.clientes.sinConfigurar).toBe(2)
    expect(negocio.cuentas[0]).toMatchObject({
      nombre: 'Tienda Nueva', correo: 'cliente@example.com',
      estado: 'sin_configurar', tieneSuscripcion: false, linkPagoDisponible: false,
    })
  })

  it('no oculta cuentas silenciosamente cuando falla su lectura', async () => {
    const { db } = base(true)
    await expect(leerNegocio(db, periodo)).rejects.toThrow('DB unavailable')
  })
})
