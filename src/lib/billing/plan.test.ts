import { describe, expect, it } from 'vitest'

import { acceso, aSuscripcion, type EstadoSuscripcion } from './plan'
import { cuentaDelPeriodo, periodoDe } from './uso'

/**
 * La cuenta de lo que paga un comercio.
 *
 * Es la aritmética que decide cuánta plata entra, y no tiene UI que la delate:
 * un error acá no rompe una pantalla, cobra de menos durante meses.
 *
 * Las dos reglas que se prueban salieron de la forma del negocio en esta etapa:
 * a los primeros comercios se les instala gratis, y la prueba que vence no
 * puede apagarle los agentes a nadie.
 */

const PLAN = {
  id: 'p1',
  slug: 'pro',
  nombre: 'Pro',
  activo: true,
  precio_centavos: 29900,
  moneda: 'usd',
  incluidas: 2000,
  excedente_centavos: 20,
  stripe_price_id: 'price_x',
  stripe_price_excedente_id: null,
  orden: 1,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sus = (over: Record<string, unknown> = {}): any =>
  aSuscripcion({
    workspace_id: 'ws-1',
    plan_id: 'p1',
    estado: 'activa',
    prueba_hasta: null,
    periodo_desde: null,
    periodo_hasta: null,
    precio_centavos_override: null,
    incluidas_override: null,
    excedente_centavos_override: null,
    nota: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    cancelar_al_final: false,
    billing_plans: PLAN,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

const uso = (conversaciones: number) => ({
  desde: '2026-08-01T00:00:00.000Z',
  hasta: '2026-09-01T00:00:00.000Z',
  conversaciones,
  respuestas: conversaciones * 3,
  costoUsd: 0,
})

describe('lo que paga una cuenta', () => {
  it('dentro del cupo paga sólo la base', () => {
    const c = cuentaDelPeriodo(sus(), uso(1500))
    expect(c.excedidas).toBe(0)
    expect(c.totalCentavos).toBe(29900)
  })

  it('pasado el cupo suma el excedente, no lo redondea', () => {
    const c = cuentaDelPeriodo(sus(), uso(2500))
    expect(c.excedidas).toBe(500)
    expect(c.excedenteCentavos).toBe(500 * 20)
    expect(c.totalCentavos).toBe(29900 + 10000)
  })

  it('el trato propio de una cuenta le gana al plan', () => {
    // Es el caso real: a algunos comercios se les hace otro precio, y el precio
    // de lista NO puede aparecer en su pantalla.
    const c = cuentaDelPeriodo(
      sus({ precio_centavos_override: 9900, incluidas_override: 500 }),
      uso(600),
    )
    expect(c.baseCentavos).toBe(9900)
    expect(c.excedidas).toBe(100)
    expect(c.totalCentavos).toBe(9900 + 100 * 20)
  })

  it('la cortesía no paga nada, diga lo que diga el plan', () => {
    // Se lo instalamos gratis. Cobrarle el excedente a alguien a quien le
    // dijimos que no paga sería exactamente lo contrario de lo acordado.
    const s = sus({ estado: 'cortesia' })
    expect(s.precioCentavos).toBe(0)
    expect(s.tratoPropio).toBe(true)
    expect(cuentaDelPeriodo(s, uso(9999)).baseCentavos).toBe(0)
  })
})

describe('quién puede seguir usando Riverz', () => {
  const enPrueba = (dias: number) =>
    sus({
      estado: 'prueba',
      prueba_hasta: new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString(),
    })

  it('con prueba vigente, sí', () => {
    const a = acceso(enPrueba(3))
    expect(a.puede).toBe(true)
    expect(a.diasDePrueba).toBe(3)
  })

  it('con la prueba vencida, no', () => {
    const a = acceso(enPrueba(-1))
    expect(a.puede).toBe(false)
    expect(a.estado).toBe('vencida')
  })

  it('la cortesía no vence nunca', () => {
    expect(acceso(sus({ estado: 'cortesia' })).puede).toBe(true)
  })

  it('una cuenta sin fila todavía puede: no está vencida, es vieja', () => {
    // Las cuentas anteriores a que existiera la facturación no tienen fila, y
    // dejarlas afuera sería cortarles el servicio por una migración.
    expect(acceso(null).puede).toBe(true)
  })

  it('cancelada y vencida no pueden', () => {
    for (const estado of ['cancelada', 'vencida'] as EstadoSuscripcion[]) {
      expect(acceso(sus({ estado })).puede, estado).toBe(false)
    }
  })
})

describe('el período que se factura', () => {
  it('con suscripción activa lo dice Stripe', () => {
    const p = periodoDe(
      sus({
        periodo_desde: '2026-08-10T00:00:00.000Z',
        periodo_hasta: '2026-09-10T00:00:00.000Z',
      }),
    )
    expect(p.desde.toISOString()).toBe('2026-08-10T00:00:00.000Z')
  })

  it('sin ella es el mes corrido, que es lo que la persona espera ver', () => {
    const p = periodoDe(sus({ periodo_desde: null, periodo_hasta: null }))
    expect(p.desde.getUTCDate()).toBe(1)
    expect(p.hasta.getTime()).toBeGreaterThan(p.desde.getTime())
  })
})
