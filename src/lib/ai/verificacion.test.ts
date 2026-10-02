import { describe, expect, it, vi } from 'vitest'

const jev = vi.hoisted(() => ({ hay: true, respuesta: null as null | Record<string, unknown>, estados: [] as unknown[] }))
vi.mock('./jev', () => ({
  hayJev: () => jev.hay,
  preguntarJev: async (o: { state: unknown }) => {
    jev.estados.push(o.state)
    return jev.respuesta ? { answers: jev.respuesta, model: 'jev-1.13.0', usage: { input_tokens: 1, output_tokens: 0 } } : null
  },
}))

import {
  preguntasDeVerificacion,
  reglasDeSalidaPara,
  veredictoDesde,
  verificarRespuesta,
} from './verificacion'

const noul = (n: number) => ({ type: 'noul' as const, noul: n })

describe('reglasDeSalidaPara', () => {
  const products = [
    { id: 'a', never_say: ['Cura el acné'], allowed_offers: [{ label: '2x1', total: 100, conditions: 'hasta el viernes' }] },
    { id: 'b', never_say: ['Es el mejor del mercado', null, 3], allowed_offers: null },
    { id: 'c', never_say: [] },
    { id: 'd', never_say: ['Del cuarto producto: no entra'] },
  ]

  it('toma el producto detectado y los primeros del catálogo, como el prompt', () => {
    const r = reglasDeSalidaPara(products, 'b', [])
    // El "3" entra tal cual: es lo mismo que le llegó al prompt (`asStrings`).
    expect(r.prohibido).toEqual(['Es el mejor del mercado', '3', 'Cura el acné'])
    expect(r.ofertas).toEqual(['2x1: 100 (hasta el viernes)'])
  })

  it('suma lo que la casa marcó como "nunca", sin el prefijo con que se guarda', () => {
    const r = reglasDeSalidaPara(products, null, [
      { clave: 'nunca', hacer: 'Nunca digas ni prometas esto: envío en 24 horas' },
      { clave: 'siempre', hacer: 'En cada conversación tiene que quedar dicho esto: gracias' },
      { clave: null, hacer: 'Sé amable' },
    ])
    expect(r.prohibido).toContain('envío en 24 horas')
    expect(r.prohibido).not.toContain('gracias')
    expect(r.prohibido).not.toContain('Sé amable')
  })
})

describe('preguntasDeVerificacion y veredictoDesde', () => {
  const reglas = { prohibido: ['Cura el acné', 'Garantía de por vida'], ofertas: ['1 unidad: 39990'] }

  it('una pregunta literal por prohibición y una por las promociones', () => {
    const q = preguntasDeVerificacion(reglas)
    expect(Object.keys(q)).toEqual(['descuentos_acumulados', 'prohibido_0', 'prohibido_1', 'oferta_no_autorizada'])
    expect(JSON.stringify(q.prohibido_1)).toContain('`prohibido[1]`')
  })

  it('sin ofertas cargadas no se pregunta por ofertas', () => {
    expect(Object.keys(preguntasDeVerificacion({ prohibido: ['x'], ofertas: [] }))).toEqual(['descuentos_acumulados', 'prohibido_0'])
  })

  it('frena sólo con 0,85 o más y dice qué regla se rompió', () => {
    expect(
      veredictoDesde({ prohibido_0: noul(0.03), prohibido_1: noul(0.84), oferta_no_autorizada: noul(0.1) }, reglas),
    ).toEqual({ ok: true, motivos: [], maximo: 0.84 })
    const v = veredictoDesde({ prohibido_0: noul(0.97), prohibido_1: noul(0.02), oferta_no_autorizada: noul(0.9) }, reglas)
    expect(v.ok).toBe(false)
    expect(v.motivos[0]).toBe('Cura el acné')
    expect(v.motivos[1]).toContain('promoción')
  })

  it('una respuesta que falta cuenta como que no', () => {
    expect(veredictoDesde({}, reglas).ok).toBe(true)
  })
})

describe('verificarRespuesta', () => {
  it.each([
    'Con el cupón REVITALY5 (5%) más el 10% por transferencia, queda en $53.001,45.',
    'El 5% de la web más el 10% por transferencia te da 15%.',
  ])('blocks stacking even without Jev or merchant rules: %s', async respuesta => {
    jev.hay = false
    const result = await verificarRespuesta({ db: {} as never, workspaceId: 'any-merchant', respuesta, ultimoMensaje: null, reglas: { prohibido: [], ofertas: [] } })
    expect(result?.ok).toBe(false)
    expect(result?.motivos.join(' ')).toContain('Combinar varios cupones')
    jev.hay = true
  })

  it('checks implicit stacking even when merchant instructions allow it', async () => {
    jev.hay = true
    jev.respuesta = { descuentos_acumulados: noul(0.98) }
    const result = await verificarRespuesta({ db: {} as never, workspaceId: 'w', respuesta: 'El cupón te deja un 5% y luego la transferencia descuenta otro 10% de ese subtotal.', ultimoMensaje: null, reglas: { prohibido: [], ofertas: ['Combina el cupón con transferencia'] } })
    expect(result?.ok).toBe(false)
    expect(result?.motivos.join(' ')).toContain('Combinar varios cupones')
    jev.respuesta = null
  })

  it('sin reglas no gasta una llamada; sin Jev tampoco', async () => {
    jev.estados.length = 0
    expect(await verificarRespuesta({ db: {} as never, workspaceId: 'w', respuesta: 'hola', ultimoMensaje: null, reglas: { prohibido: [], ofertas: [] } })).toBeNull()
    jev.hay = false
    expect(await verificarRespuesta({ db: {} as never, workspaceId: 'w', respuesta: 'hola', ultimoMensaje: null, reglas: { prohibido: ['x'], ofertas: [] } })).toBeNull()
    expect(jev.estados).toHaveLength(0)
    jev.hay = true
  })

  it('manda la respuesta, el último mensaje y las reglas, y devuelve el veredicto', async () => {
    jev.estados.length = 0
    jev.respuesta = { prohibido_0: noul(0.95) }
    const v = await verificarRespuesta({
      db: {} as never,
      workspaceId: 'w',
      respuesta: 'Sí, cura el acné en una semana',
      ultimoMensaje: '¿me cura el acné?',
      reglas: { prohibido: ['Cura el acné'], ofertas: [] },
    })
    expect(v).toEqual({ ok: false, motivos: ['Cura el acné'], maximo: 0.95 })
    expect(jev.estados[0]).toEqual({
      respuesta: 'Sí, cura el acné en una semana',
      ultimo_mensaje_del_cliente: '¿me cura el acné?',
      prohibido: ['Cura el acné'],
    })
  })

  it('si Jev no contesta, no hay veredicto: la respuesta sale como siempre', async () => {
    jev.respuesta = null
    expect(await verificarRespuesta({ db: {} as never, workspaceId: 'w', respuesta: 'x', ultimoMensaje: null, reglas: { prohibido: ['x'], ofertas: [] } })).toBeNull()
  })
})
