import { describe, expect, it } from 'vitest'

import { montoCoincide, registerReportedPayment } from './reported-payment'

/**
 * Lo que decide si se marca un pedido pagado sin que nadie lo mire.
 *
 * El monto solo no alcanza y estos tests existen para que eso no se vuelva a
 * olvidar: medido en producción sobre 90 días, CUATRO montos cubren el 79% de
 * 558 pedidos y el precio está publicado en el anuncio. Acertar el número es
 * trivial; lo que hay que probar es que hubo una transferencia.
 */

type Fila = Record<string, unknown>

/**
 * Doble de Supabase con lo justo: `orders` (pendientes, y la búsqueda de la
 * referencia ya usada) y `messages` (si hay un archivo adjunto).
 */
function db(opts: {
  pendientes?: Fila[]
  referenciaUsadaPor?: Fila | null
  hayAdjunto?: boolean
  /** La fila de configuración de la cuenta. Sin ella rigen las de siempre. */
  config?: Fila | null
  /** Un pedido de esta persona que YA está pagado. Es la otra rama de "no hay
   *  pendiente", y son respuestas opuestas. */
  pagado?: Fila | null
}) {
  const escrituras: Fila[] = []
  const pendientes = opts.pendientes ?? []
  const from = (tabla: string) => {
    if (tabla === 'workspace_checkout_config') {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.maybeSingle = async () => ({ data: opts.config ?? null })
      return q
    }
    if (tabla === 'messages') {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'gte']) q[m] = () => q
      q.limit = async () => ({ data: opts.hayAdjunto ? [{ id: 'm1' }] : [] })
      return q
    }
    // orders
    const q: Record<string, unknown> = {}
    let esBusquedaDeReferencia = false
    let esBusquedaDePagado = false
    q.select = () => q
    q.eq = (col: string, val: unknown) => {
      if (col === 'payment_reference') esBusquedaDeReferencia = true
      if (col === 'financial_status' && val === 'paid') esBusquedaDePagado = true
      return q
    }
    q.neq = () => q
    q.order = () => q
    q.update = (patch: Fila) => {
      escrituras.push(patch)
      return { eq: async () => ({ data: null, error: null }) }
    }
    q.limit = (n: number) => {
      if (esBusquedaDeReferencia) {
        return { maybeSingle: async () => ({ data: opts.referenciaUsadaPor ?? null }) }
      }
      if (esBusquedaDePagado) {
        return { maybeSingle: async () => ({ data: opts.pagado ?? null, error: null }) }
      }
      const r = { data: pendientes.slice(0, n), error: null }
      return Object.assign(Promise.resolve(r), {
        maybeSingle: async () => ({ data: pendientes[0] ?? null, error: null }),
      })
    }
    return q
  }
  return { db: { from } as never, escrituras }
}

const PEDIDO = {
  id: 'o1',
  shopify_order_id: '111',
  order_number: '#52711',
  total_price: '39990',
  currency: 'ARS',
  financial_status: 'pending',
}

const BASE = {
  workspaceId: 'w1',
  contactId: 'c1',
  amount: 39990,
  desdeComprobante: true,
  referencia: 'OP-12345',
}

describe('montoCoincide', () => {
  it('acepta el mismo monto y rechaza otro', () => {
    expect(montoCoincide('39990', 39990)).toBe(true)
    expect(montoCoincide('39990', 39000)).toBe(false)
    expect(montoCoincide('39990', null)).toBe(false)
    expect(montoCoincide(null, 39990)).toBe(false)
  })
})

describe('no se cobra solo sin una prueba de verdad', () => {
  it('sin comprobante adjunto, aunque el monto coincida', async () => {
    // El caso barato: escribir "ya te transferí 39990". Sin esto alcanzaba.
    const { db: d } = db({ pendientes: [PEDIDO], hayAdjunto: false })
    const r = await registerReportedPayment({ ...BASE, db: d })
    expect(r.kind).toBe('a_confirmar')
    if (r.kind === 'a_confirmar') expect(r.reason).toMatch(/comprobante/i)
  })

  it('si el monto lo sacó del texto y no de una imagen', async () => {
    const { db: d } = db({ pendientes: [PEDIDO], hayAdjunto: true })
    const r = await registerReportedPayment({
      ...BASE,
      desdeComprobante: false,
      db: d,
    })
    expect(r.kind).toBe('a_confirmar')
  })

  it('con dos pedidos pendientes: no se sabe cuál pagó', async () => {
    const { db: d } = db({
      pendientes: [PEDIDO, { ...PEDIDO, id: 'o2', order_number: '#52712' }],
      hayAdjunto: true,
    })
    const r = await registerReportedPayment({ ...BASE, db: d })
    expect(r.kind).toBe('a_confirmar')
    if (r.kind === 'a_confirmar') expect(r.reason).toMatch(/más de un pedido/i)
  })

  it('sin número de operación, porque la misma captura pagaría dos veces', async () => {
    const { db: d } = db({ pendientes: [PEDIDO], hayAdjunto: true })
    const r = await registerReportedPayment({ ...BASE, referencia: null, db: d })
    expect(r.kind).toBe('a_confirmar')
    if (r.kind === 'a_confirmar') expect(r.reason).toMatch(/operación/i)
  })

  it('si ese comprobante ya pagó otro pedido', async () => {
    const { db: d } = db({
      pendientes: [PEDIDO],
      hayAdjunto: true,
      referenciaUsadaPor: { id: 'o9', order_number: '#52700' },
    })
    const r = await registerReportedPayment({ ...BASE, db: d })
    expect(r.kind).toBe('a_confirmar')
    if (r.kind === 'a_confirmar') expect(r.reason).toMatch(/ya se usó/i)
  })

  it('si el monto no coincide', async () => {
    const { db: d } = db({ pendientes: [PEDIDO], hayAdjunto: true })
    const r = await registerReportedPayment({ ...BASE, amount: 100, db: d })
    expect(r.kind).toBe('a_confirmar')
  })

  it('sin pedido pendiente no inventa uno', async () => {
    const { db: d } = db({ pendientes: [], hayAdjunto: true })
    const r = await registerReportedPayment({ ...BASE, db: d })
    expect(r.kind).toBe('sin_pedido')
  })
})

/**
 * Las mismas pruebas, pero elegidas por el comercio.
 *
 * Un negocio de presupuestos únicos tiene en el monto una prueba de verdad y
 * puede aflojar el resto; uno de cuatro precios repetidos, no. Lo que no se
 * afloja nunca es cobrar dos veces con el mismo número de operación: eso no es
 * una política, es un error.
 */
describe('las condiciones las pone la cuenta', () => {
  const SIN_COMPROBANTE = {
    pago_exige_comprobante: false,
    pago_un_solo_pendiente: true,
    pago_exige_referencia: false,
    pago_tolerancia_pct: 0.1,
  }

  it('sin exigir comprobante ni referencia, el monto solo alcanza', async () => {
    const { db: d } = db({
      pendientes: [PEDIDO],
      hayAdjunto: false,
      config: SIN_COMPROBANTE,
    })
    const r = await registerReportedPayment({
      ...BASE,
      desdeComprobante: false,
      referencia: null,
      db: d,
    })
    // Llega hasta el final: lo único que lo frena es que el pedido no está en
    // ninguna tienda conectada en este doble.
    expect(r.kind).toBe('a_confirmar')
    if (r.kind === 'a_confirmar') expect(r.reason).toMatch(/tienda|Shopify/i)
  })

  it('pero el mismo comprobante sigue sin pagar dos pedidos', async () => {
    const { db: d } = db({
      pendientes: [PEDIDO],
      hayAdjunto: false,
      config: SIN_COMPROBANTE,
      referenciaUsadaPor: { id: 'o9', order_number: '#52700' },
    })
    const r = await registerReportedPayment({ ...BASE, db: d })
    expect(r.kind).toBe('a_confirmar')
    if (r.kind === 'a_confirmar') expect(r.reason).toMatch(/ya se usó/i)
  })

  it('con más tolerancia, una diferencia de centavos ya no molesta', async () => {
    const { db: d } = db({
      pendientes: [PEDIDO],
      hayAdjunto: true,
      config: { ...SIN_COMPROBANTE, pago_tolerancia_pct: 1 },
    })
    // 39.990 contra 39.800: 0,48% de diferencia.
    const r = await registerReportedPayment({ ...BASE, amount: 39800, db: d })
    if (r.kind === 'a_confirmar') expect(r.reason).not.toMatch(/comprobante dice/i)
    expect(montoCoincide('39990', 39800, 1)).toBe(true)
    expect(montoCoincide('39990', 39800, 0.1)).toBe(false)
  })

  it('las reglas quedan anotadas con el pago, para poder auditarlo', async () => {
    const { db: d, escrituras } = db({ pendientes: [PEDIDO], hayAdjunto: false })
    await registerReportedPayment({ ...BASE, db: d })
    const ev = escrituras[0].payment_evidence as Record<string, unknown>
    expect((ev.reglas as Record<string, unknown>).exigeComprobante).toBe(true)
  })
})

describe('dejar de insistir pasa SIEMPRE', () => {
  it('aunque no se cobre, queda anotado que dijo que pagó', async () => {
    const { db: d, escrituras } = db({ pendientes: [PEDIDO], hayAdjunto: false })
    await registerReportedPayment({ ...BASE, db: d })
    expect(escrituras.length).toBeGreaterThan(0)
    expect(escrituras[0].payment_reported_at).toBeTruthy()
  })

  it('y queda la evidencia de qué se leyó, para poder explicarlo después', async () => {
    const { db: d, escrituras } = db({ pendientes: [PEDIDO], hayAdjunto: false })
    await registerReportedPayment({
      ...BASE,
      leido: { fecha: '15/08', destino: 'alias.pilar', titular: 'Ana' },
      db: d,
    })
    const ev = escrituras[0].payment_evidence as Record<string, unknown>
    expect(ev.referencia).toBe('OP-12345')
    expect(ev.desde_comprobante).toBe(true)
    expect((ev.leido as Record<string, unknown>).destino).toBe('alias.pilar')
  })
})

/**
 * "Ya te transferi" cuando el pedido YA estaba pagado.
 *
 * La consulta de pendientes descarta los pagados, asi que esto caia en
 * `sin_pedido` y de ahi salia "lo estamos verificando y te aviso" — falso, y
 * encima mandaba a una persona a revisar algo resuelto. Visto en produccion el
 * 2026-08-30: el pedido figuraba pagado SEIS MINUTOS antes de que la clienta
 * mandara el comprobante.
 */
describe('el pedido ya estaba pagado', () => {
  const PAGADO = { order_number: '#52733', total_price: '39990', currency: 'ARS' }

  it('lo dice, con el numero de pedido', async () => {
    const { db: d } = db({ pendientes: [], pagado: PAGADO })
    const res = await registerReportedPayment({
      db: d,
      workspaceId: 'w1',
      contactId: 'c1',
      amount: 39990,
      desdeComprobante: true,
    })
    expect(res.kind).toBe('ya_pagado')
    if (res.kind !== 'ya_pagado') return
    expect(res.orderNumber).toBe('#52733')
    expect(res.total).toBe('39990')
  })

  it('sin ningun pedido sigue siendo sin_pedido', async () => {
    // La otra mitad: no confundir "ya esta" con "no lo encontramos". El
    // segundo SI tiene que ir a una persona.
    const { db: d } = db({ pendientes: [], pagado: null })
    const res = await registerReportedPayment({
      db: d,
      workspaceId: 'w1',
      contactId: 'c1',
      amount: 39990,
      desdeComprobante: true,
    })
    expect(res.kind).toBe('sin_pedido')
  })

  it('con un pendiente NO mira los pagados: se cobra ese', async () => {
    const { db: d } = db({ pendientes: [PEDIDO], pagado: PAGADO, hayAdjunto: true })
    const res = await registerReportedPayment({
      db: d,
      workspaceId: 'w1',
      contactId: 'c1',
      amount: 39990,
      desdeComprobante: true,
      referencia: '0001234567',
    })
    expect(res.kind).not.toBe('ya_pagado')
  })
})
