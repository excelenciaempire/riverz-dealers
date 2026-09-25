import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { leerNegocio } from './negocio'

const planDeSaldo = {
  id: 'p-saldo', slug: 'saldo-ilimitado', nombre: 'Contactos ilimitados con saldo', activo: true,
  precio_centavos: 39900, moneda: 'usd', incluidas: 0, excedente_centavos: 0,
  stripe_price_id: null, stripe_price_excedente_id: null, orden: 90,
}

function suscripcion(workspace_id: string, fila: Record<string, unknown>) {
  return {
    workspace_id, plan_id: planDeSaldo.id, estado: 'cortesia', prueba_hasta: null,
    periodo_desde: null, periodo_hasta: null, vencida_desde: null,
    precio_centavos_override: null, incluidas_override: null, excedente_centavos_override: null,
    nota: null, stripe_customer_id: null, stripe_subscription_id: null, cancelar_al_final: false,
    modelo_cobro: 'saldo', billing_plans: planDeSaldo, ...fila,
  }
}

function base(fallarWorkspaces = false, suscripciones: unknown[] = []) {
  const rows: Record<string, unknown[]> = {
    workspace_subscriptions: suscripciones,
    workspaces: [
      { id: 'w1', name: 'Tienda Nueva', owner_id: 'u1' },
      { id: 'w2', name: 'Otra Tienda', owner_id: 'u2' },
    ],
    profiles: [{ user_id: 'u1', email: 'cliente@example.com' }],
    billing_usage_daily: [],
    wallet_accounts: [],
    wallet_movimientos: [],
    ai_agents: [{ workspace_id: 'w2' }],
  }
  const from = vi.fn((table: string) => {
    const result = { data: rows[table] ?? [], error: table === 'workspaces' && fallarWorkspaces ? new Error('DB unavailable') : null }
    const q = {
      select: () => q, is: () => q, gte: () => q, lt: () => q,
      limit: () => q, in: () => q, not: () => q,
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
      admiteLinkPago: true, precioAcuerdoCentavos: 0, tieneClavePropia: false,
    })
    expect(negocio.cuentas[1]).toMatchObject({ nombre: 'Otra Tienda', tieneClavePropia: true })
  })

  it('expone la mensualidad pactada y si todavía se cobra con link', async () => {
    const { db } = base(false, [
      suscripcion('w1', {}),
      suscripcion('w2', { estado: 'activa', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }),
    ])
    const negocio = await leerNegocio(db, periodo)
    const cuenta = (id: string) => negocio.cuentas.find((c) => c.workspaceId === id)
    expect(cuenta('w1')).toMatchObject({
      estado: 'cortesia', modeloCobro: 'saldo', mrrCentavos: 0, precioAcuerdoCentavos: 39900,
      incluidas: 0, admiteLinkPago: true, linkPagoDisponible: true,
    })
    expect(cuenta('w2')).toMatchObject({
      estado: 'activa', mrrCentavos: 39900, precioAcuerdoCentavos: 39900,
      admiteLinkPago: false, linkPagoDisponible: false,
    })
  })

  it('no oculta cuentas silenciosamente cuando falla su lectura', async () => {
    const { db } = base(true)
    await expect(leerNegocio(db, periodo)).rejects.toThrow('DB unavailable')
  })
})
