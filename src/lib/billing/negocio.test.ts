import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { estadoDePago, leerNegocio } from './negocio'
import { aSuscripcion } from './plan'

afterEach(() => vi.restoreAllMocks())

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

function base(fallarWorkspaces = false, suscripciones: unknown[] = [], extras: Record<string, unknown[]> = {}) {
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
    ...extras,
  }
  const from = vi.fn((table: string) => {
    const result = { data: rows[table] ?? [], error: table === 'workspaces' && fallarWorkspaces ? new Error('DB unavailable') : null }
    const q = {
      select: () => q, is: () => q, gte: () => q, lt: () => q,
      limit: () => q, in: () => q, not: () => q, order: () => q,
      range: (from: number, to: number) => Promise.resolve({ ...result, data: result.data.slice(from, to + 1) }),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    return q
  })
  return { db: { from } as unknown as SupabaseClient, from }
}

describe('cuentas de Negocio', () => {
  const periodo = { desde: new Date('2026-09-01'), hasta: new Date('2026-10-01') }

  it('no cuenta una prueba vencida como una prueba activa', () => {
    const actual = aSuscripcion(suscripcion('w1', {
      estado: 'prueba', prueba_hasta: '2026-09-08T00:00:00Z',
    }) as Parameters<typeof aSuscripcion>[0])
    expect(estadoDePago(actual, Date.parse('2026-09-07T23:59:59Z'))).toBe('en_prueba')
    expect(estadoDePago(actual, Date.parse('2026-09-08T00:00:00Z'))).toBe('sin_pagar')
    expect(estadoDePago(actual, Date.parse('2026-09-27T00:00:00Z'))).toBe('sin_pagar')
    expect(estadoDePago({ ...actual, pruebaHasta: null })).toBe('sin_pagar')
  })

  it('muestra los workspaces nuevos aun sin fila de suscripción', async () => {
    const { db } = base()
    const negocio = await leerNegocio(db, periodo)
    expect(negocio.cuentas).toHaveLength(2)
    expect(negocio.porPago.sin_configurar).toBe(2)
    expect(negocio.cuentas[0]).toMatchObject({
      nombre: 'Tienda Nueva', correo: 'cliente@example.com',
      pago: 'sin_configurar', tieneSuscripcion: false,
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
      pago: 'sin_pagar', modeloCobro: 'saldo', mrrCentavos: 0, precioAcuerdoCentavos: 39900,
      incluidas: 0, admiteLinkPago: true, suscripcionExterna: false,
    })
    expect(cuenta('w2')).toMatchObject({
      pago: 'al_dia', mrrCentavos: 39900, precioAcuerdoCentavos: 39900,
      admiteLinkPago: false, suscripcionExterna: true,
    })
    expect(negocio.porPago).toMatchObject({ al_dia: 1, sin_pagar: 1 })
    expect(negocio.pagando).toBe(1)
  })

  it('dice si ya paga en Stripe o todavía no', async () => {
    const { db } = base(false, [
      suscripcion('w1', { estado: 'activa', precio_centavos_override: 0 }),
      suscripcion('w2', { estado: 'vencida', stripe_subscription_id: 'sub_2' }),
    ])
    const negocio = await leerNegocio(db, periodo)
    const cuenta = (id: string) => negocio.cuentas.find((c) => c.workspaceId === id)
    expect(cuenta('w1')?.pago).toBe('sin_mensualidad')
    expect(cuenta('w2')?.pago).toBe('fallido')
    expect(negocio.mrrCentavos).toBe(0)
  })

  it('la cuenta que no pagó su link figura sin pagar, tenga o no mensualidad', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-27T00:00:00Z'))
    const { db } = base(false, [
      suscripcion('w1', { estado: 'cortesia', precio_centavos_override: 0 }),
      suscripcion('w2', { estado: 'prueba', prueba_hasta: '2026-09-30T00:00:00.000Z' }),
    ])
    const negocio = await leerNegocio(db, periodo)
    const cuenta = (id: string) => negocio.cuentas.find((c) => c.workspaceId === id)
    expect(cuenta('w1')?.pago).toBe('sin_pagar')
    expect(cuenta('w2')).toMatchObject({ pago: 'en_prueba', pruebaHasta: '2026-09-30T00:00:00.000Z' })
  })

  it('no oculta cuentas silenciosamente cuando falla su lectura', async () => {
    const { db } = base(true)
    await expect(leerNegocio(db, periodo)).rejects.toThrow('DB unavailable')
  })

  it('suma todas las páginas y no presenta ajustes ni comisiones como consumo', async () => {
    const { db } = base(false, [], {
      wallet_movimientos: [
        ...Array.from({ length: 1005 }, () => ({ workspace_id: 'w1', tipo: 'consumo', concepto: 'ia_respuesta', centavos: -2, costo_centavos: 1 })),
        { workspace_id: 'w1', tipo: 'ajuste', concepto: 'ajuste', centavos: -500, costo_centavos: 0 },
        { workspace_id: 'w1', tipo: 'consumo', concepto: 'comision_stripe', centavos: -25, costo_centavos: 25 },
        { workspace_id: 'w1', tipo: 'recarga', centavos: 3000, costo_centavos: 0 },
      ],
      billing_usage_daily: Array.from({ length: 1005 }, () => ({ workspace_id: 'w1', conversaciones: 1, costo_usd: 1 })),
    })
    const negocio = await leerNegocio(db, periodo)
    expect(negocio).toMatchObject({ gastadoCentavos: 2010, costoBilleteraCentavos: 1005, cargadoCentavos: 3000, costoUsd: 1005 })
    expect(negocio.cuentas.find(c => c.workspaceId === 'w1')?.conversaciones).toBe(1005)
  })
})
