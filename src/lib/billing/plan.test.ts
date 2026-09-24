import { describe, expect, it } from 'vitest'

import { acceso, aSuscripcion } from './plan'
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
  precio_centavos: 39900,
  moneda: 'usd',
  incluidas: 500,
  excedente_centavos: 0,
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
    vencida_desde: null,
    precio_centavos_override: null,
    incluidas_override: null,
    excedente_centavos_override: null,
    nota: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    cancelar_al_final: false,
    modelo_cobro: 'oficial',
    billing_plans: PLAN,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

const uso = (conversaciones: number) => ({
  desde: '2026-08-01T00:00:00.000Z',
  hasta: '2026-09-01T00:00:00.000Z',
  contactos: conversaciones,
  conversaciones,
  respuestas: conversaciones * 3,
  costoUsd: 0,
})

describe('lo que paga una cuenta', () => {
  it('reconoce Shopify por el GID sin otra columna de proveedor', () => {
    const subscription = sus({
      stripe_subscription_id: 'gid://shopify/AppSubscription/123',
      stripe_customer_id: 'riverz-demo.myshopify.com',
    })
    expect(subscription.billingProvider).toBe('shopify')
    expect(subscription.shopifySubscriptionId).toBe('gid://shopify/AppSubscription/123')
    expect(subscription.shopifyShopDomain).toBe('riverz-demo.myshopify.com')
  })

  it('conserva el modelo de saldo sólo cuando está declarado', () => {
    expect(sus({ modelo_cobro: 'saldo' }).modeloCobro).toBe('saldo')
    expect(sus({ modelo_cobro: 'otro' }).modeloCobro).toBe('oficial')
  })
  it('dentro del cupo paga sólo la base', () => {
    const c = cuentaDelPeriodo(sus(), uso(400))
    expect(c.excedidas).toBe(0)
    expect(c.totalCentavos).toBe(39900)
  })

  it('el plan oficial muestra el exceso sin cobrarlo automáticamente', () => {
    const c = cuentaDelPeriodo(sus(), uso(600))
    expect(c.excedidas).toBe(100)
    expect(c.excedenteCentavos).toBe(0)
    expect(c.totalCentavos).toBe(39900)
  })

  it('el plan oficial cuenta personas, no conversaciones repetidas', () => {
    const c = cuentaDelPeriodo(sus(), { ...uso(900), contactos: 120 })
    expect(c.uso.conversaciones).toBe(900)
    expect(c.excedidas).toBe(0)
    expect(c.totalCentavos).toBe(39900)
  })

  it('el trato propio de una cuenta le gana al precio del plan', () => {
    // Es el caso real: a algunos comercios se les hace otro precio, y el precio
    // de lista NO puede aparecer en su pantalla.
    const c = cuentaDelPeriodo(
      sus({ precio_centavos_override: 9900, incluidas_override: 500 }),
      uso(600),
    )
    expect(c.baseCentavos).toBe(9900)
    expect(c.excedidas).toBe(100)
    expect(c.totalCentavos).toBe(9900)
  })

  it('el acuerdo de saldo conserva su excedente por conversación si fue pactado', () => {
    const c = cuentaDelPeriodo(
      sus({ modelo_cobro: 'saldo', incluidas_override: 500, excedente_centavos_override: 20 }),
      { ...uso(600), contactos: 300 },
    )
    expect(c.excedidas).toBe(100)
    expect(c.excedenteCentavos).toBe(2000)
  })

  it('la cortesía no paga nada, diga lo que diga el plan', () => {
    // Se lo instalamos gratis. Cobrarle el excedente a alguien a quien le
    // dijimos que no paga sería exactamente lo contrario de lo acordado.
    const s = sus({ estado: 'cortesia' })
    expect(s.precioCentavos).toBe(0)
    expect(s.precioAcuerdoCentavos).toBe(39900)
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

  it('cancelada no puede', () => {
    expect(acceso(sus({ estado: 'cancelada' })).puede).toBe(false)
  })

  it('vencida hace una hora todavía puede: está en la gracia', () => {
    const a = acceso(
      sus({
        estado: 'vencida',
        vencida_desde: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }),
    )
    expect(a.puede).toBe(true)
    expect(a.horasDeGracia).toBe(47)
  })

  it('vencida hace tres días ya no puede', () => {
    const a = acceso(
      sus({
        estado: 'vencida',
        vencida_desde: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
      }),
    )
    expect(a.puede).toBe(false)
    expect(a.horasDeGracia).toBe(0)
  })

  it('vencida sin marca de cuándo: se le da la gracia igual', () => {
    // La marca la escribe el webhook. Una cuenta que quedó vencida antes de que
    // esa columna existiera no tiene por qué pagar ese hueco con su operación.
    const a = acceso(sus({ estado: 'vencida' }))
    expect(a.puede).toBe(true)
    expect(a.horasDeGracia).toBe(48)
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

describe('la cancelación no corta el mes ya pagado', () => {
  const enDias = (n: number) =>
    new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString()

  it('cancelada con el período corriendo, sigue entrando', () => {
    // Cancelar en Stripe "ahora" corta la suscripción al instante. El mes ya
    // está cobrado: cortarle el acceso el mismo día es quedarse con plata suya.
    const a = acceso(sus({ estado: 'cancelada', periodo_hasta: enDias(12) }))
    expect(a.puede).toBe(true)
  })

  it('cancelada con el período terminado, ya no', () => {
    expect(acceso(sus({ estado: 'cancelada', periodo_hasta: enDias(-1) })).puede).toBe(false)
  })

  it('cancelada sin fecha de período, no: no hay mes que respetar', () => {
    expect(acceso(sus({ estado: 'cancelada' })).puede).toBe(false)
  })
})
