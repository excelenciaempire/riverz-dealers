import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Suscripcion } from '@/lib/billing/plan'
import type { Billetera } from './saldo'

/**
 * La cuenta que todavía no pagó su link usa la app, pero no la IA ni nada que
 * le cueste a Riverz. Paga, y arranca todo.
 */

const estado = vi.hoisted(() => ({
  sus: null as Suscripcion | null,
  saldoCentavos: 0,
}))

vi.mock('@/lib/billing/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/plan')>()),
  leerSuscripcion: async () => estado.sus,
}))

vi.mock('./saldo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./saldo')>()),
  leerBilletera: async (): Promise<Billetera> => ({
    workspaceId: 'w1',
    saldoCentavos: estado.saldoCentavos,
    reservadoCentavos: 0,
    moneda: 'usd',
    descubiertoCentavos: 0,
    bloquearSinSaldo: false,
    autoRecargaCentavos: null,
    autoUmbralCentavos: null,
    tieneTarjeta: false,
    tarjetaMarca: null,
    tarjetaUltimos4: null,
    cobrarACosto: true,
    autoFallos: 0,
    autoUltimoError: null,
  }),
}))

const { puertaDeIa, estadoDeCobro } = await import('./puerta')
const db = {} as SupabaseClient

function sus(over: Partial<Suscripcion>): Suscripcion {
  return {
    workspaceId: 'w1',
    plan: null,
    estado: 'activa',
    pruebaHasta: null,
    periodoDesde: null,
    periodoHasta: null,
    vencidaDesde: null,
    nota: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingProvider: 'stripe',
    shopifySubscriptionId: null,
    shopifyShopDomain: null,
    cancelarAlFinal: false,
    modeloCobro: 'saldo',
    precioCentavos: 39900,
    precioAcuerdoCentavos: 39900,
    incluidas: 0,
    excedenteCentavos: 0,
    tratoPropio: false,
    ...over,
  }
}

describe('la puerta de la IA', () => {
  beforeEach(() => {
    estado.sus = null
    estado.saldoCentavos = 0
  })

  it('publica una revisión distinta cuando el admin cambia el modelo o el precio', async () => {
    estado.sus = sus({ modeloCobro: 'oficial' })
    const original = (await estadoDeCobro(db, 'w1')).vistazo.revisionCobro
    estado.sus = sus({ modeloCobro: 'byok' })
    const byok = (await estadoDeCobro(db, 'w1')).vistazo.revisionCobro
    expect(byok).not.toBe(original)
    estado.sus = sus({ modeloCobro: 'byok', precioAcuerdoCentavos: 29900 })
    expect((await estadoDeCobro(db, 'w1')).vistazo.revisionCobro).not.toBe(byok)
  })

  it('sin pagar el link no hay IA, aunque tenga saldo cargado', async () => {
    estado.saldoCentavos = 5000
    for (const modeloCobro of ['saldo', 'oficial', 'byok'] as const) {
      estado.sus = sus({ estado: 'cortesia', modeloCobro })
      expect(await puertaDeIa(db, 'w1')).toMatchObject({ puede: false, motivo: 'sin_pagar' })
    }
  })

  it('sin pagar el link se puede probar, y sólo adentro de la prueba', async () => {
    const { probandoSinPagar } = await import('./prueba')
    estado.sus = sus({ estado: 'cortesia' })
    expect(await probandoSinPagar(() => puertaDeIa(db, 'w1'))).toMatchObject({ puede: true, motivo: null })
    expect(await puertaDeIa(db, 'w1')).toMatchObject({ puede: false, motivo: 'sin_pagar' })
  })

  it('sin pagar no se cierra la cuenta: se avisa arriba', async () => {
    estado.sus = sus({ estado: 'cortesia' })
    expect(await estadoDeCobro(db, 'w1')).toMatchObject({ bloqueado: false, aviso: 'sin_pagar' })
  })

  it('reveals recharge only after activation for balance-billed merchants', async () => {
    estado.sus = sus({ estado: 'cortesia' })
    expect((await estadoDeCobro(db, 'w1')).vistazo).toMatchObject({ exenta: true, sinPagar: true })
    estado.sus = sus({ estado: 'activa', stripeSubscriptionId: 'sub_1' })
    expect((await estadoDeCobro(db, 'w1')).vistazo).toMatchObject({ exenta: false, sinPagar: false })
    for (const modeloCobro of ['oficial', 'byok'] as const) {
      estado.sus = sus({ estado: 'activa', modeloCobro })
      expect((await estadoDeCobro(db, 'w1')).vistazo).toMatchObject({ exenta: true, sinPagar: false })
    }
  })

  it('pagó: con saldo corre, sin saldo se frena', async () => {
    estado.sus = sus({ estado: 'activa', stripeSubscriptionId: 'sub_1' })
    estado.saldoCentavos = 5000
    expect(await puertaDeIa(db, 'w1')).toMatchObject({ puede: true, motivo: null })
    estado.saldoCentavos = 0
    expect(await puertaDeIa(db, 'w1')).toMatchObject({ puede: false, motivo: 'sin_saldo' })
  })

  it('con plan o BYOK al día no depende del saldo', async () => {
    estado.sus = sus({ estado: 'activa', stripeSubscriptionId: 'sub_1', modeloCobro: 'oficial' })
    expect((await puertaDeIa(db, 'w1')).puede).toBe(true)
    estado.sus = sus({ estado: 'activa', stripeSubscriptionId: 'sub_1', modeloCobro: 'byok' })
    expect((await puertaDeIa(db, 'w1')).puede).toBe(true)
  })

  it('la prueba vigente y la cuenta sin configurar siguen como estaban', async () => {
    estado.sus = sus({
      estado: 'prueba',
      modeloCobro: 'oficial',
      pruebaHasta: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    })
    expect((await puertaDeIa(db, 'w1')).puede).toBe(true)
    estado.sus = null
    expect((await puertaDeIa(db, 'w1')).puede).toBe(true)
  })
})
