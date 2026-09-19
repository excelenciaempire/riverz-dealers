import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La capa 2 con Jev: la política (umbrales, qué clase gana) es pura y se
 * prueba sin red; el camino entero se prueba con Jev simulado para verificar
 * que Haiku sólo escribe la línea cuando SÍ hay escalada.
 */
const jev = vi.hoisted(() => ({
  respuesta: null as null | Record<string, unknown>,
  llamadas: 0,
  hay: true,
}))
const haiku = vi.hoisted(() => ({ llamadas: 0, linea: 'El paquete va a otra ciudad' as string | null }))

vi.mock('./jev', () => ({
  hayJev: () => jev.hay,
  preguntarJev: async () => {
    jev.llamadas += 1
    return jev.respuesta ? { answers: jev.respuesta, model: 'jev-1.13.0', usage: { input_tokens: 1, output_tokens: 0 } } : null
  },
}))
vi.mock('./medido', () => ({
  completeTextMedido: async () => {
    haiku.llamadas += 1
    return haiku.linea
  },
}))

import { detectarEscalada, escaladaDesdeJev, type RespuestasEscalada } from './escalada'

const noul = (n: number) => ({ type: 'noul' as const, noul: n })
// Sólo la opción elegida lleva probabilidad: alcanza para la política, que
// mira `choice` y `confidence`. El `never` es para no tener que escribir las
// seis opciones en cada caso.
const choice = <O extends string>(o: O, c = 0.9) =>
  ({ type: 'choice' as const, choice: o, probabilities: { [o]: c }, confidence: c }) as never

function respuestas(p: Partial<RespuestasEscalada> = {}): RespuestasEscalada {
  return {
    destino_distinto: noul(0.02),
    problema_en_curso: noul(0.03),
    pide_fuera_de_alcance: noul(0.03),
    pago_por_confirmar: noul(0.02),
    pedido_no_encontrado: noul(0.02),
    clase: choice('ninguno'),
    urgencia: choice('no_hace_falta'),
    ...p,
  } as RespuestasEscalada
}

describe('escaladaDesdeJev', () => {
  it('una conversación normal no escala', () => {
    expect(escaladaDesdeJev(respuestas())).toBeNull()
    // Mal humor sin hecho concreto: la clase se inclina a "otro" pero la
    // condición dice que no. Manda la condición.
    expect(
      escaladaDesdeJev(respuestas({ clase: choice('otro', 0.4), problema_en_curso: noul(0.2) })),
    ).toBeNull()
  })

  it('un problema real escala con su clase y urgencia', () => {
    expect(
      escaladaDesdeJev(
        respuestas({
          problema_en_curso: noul(0.98),
          clase: choice('devolucion'),
          urgencia: choice('hoy'),
        }),
      ),
    ).toEqual({ clase: 'devolucion', urgencia: 'hoy' })
  })

  it('el destino distinto escala solo, aunque "problema" dude', () => {
    // El caso de Rosanna: comparar dos ciudades es la pregunta literal.
    expect(
      escaladaDesdeJev(
        respuestas({
          destino_distinto: noul(0.97),
          problema_en_curso: noul(0.41),
          clase: choice('ninguno', 0.5),
          urgencia: choice('ahora'),
        }),
      ),
    ).toEqual({ clase: 'envio_mal', urgencia: 'ahora' })
  })

  it('pedir una excepción escala como "otro" si la clase no dice más', () => {
    expect(
      escaladaDesdeJev(
        respuestas({ pide_fuera_de_alcance: noul(0.9), clase: choice('ninguno'), urgencia: choice('hoy') }),
      ),
    ).toEqual({ clase: 'otro', urgencia: 'hoy' })
  })

  it('un pago que dice haber hecho y nadie confirmó escala como cobro', () => {
    // "[Imagen]" después de "mandanos el comprobante": la clase puede dudar,
    // la condición no.
    expect(
      escaladaDesdeJev(
        respuestas({ pago_por_confirmar: noul(0.91), clase: choice('ninguno', 0.5), urgencia: choice('hoy') }),
      ),
    ).toEqual({ clase: 'cobro', urgencia: 'hoy' })
  })

  it('un pedido que el asistente no encuentra y la persona insiste escala', () => {
    expect(
      escaladaDesdeJev(
        respuestas({ pedido_no_encontrado: noul(0.95), clase: choice('otro'), urgencia: choice('hoy') }),
      ),
    ).toEqual({ clase: 'otro', urgencia: 'hoy' })
  })

  it('por debajo del umbral no escala: escalar de más es peor', () => {
    expect(escaladaDesdeJev(respuestas({ problema_en_curso: noul(0.45) }))).toBeNull()
    expect(escaladaDesdeJev(respuestas({ destino_distinto: noul(0.65) }))).toBeNull()
    expect(escaladaDesdeJev(respuestas({ pago_por_confirmar: noul(0.55) }))).toBeNull()
    expect(escaladaDesdeJev(respuestas({ pide_fuera_de_alcance: noul(0.55) }))).toBeNull()
  })
})

describe('detectarEscalada con Jev', () => {
  const ctx = {
    mensaje: 'no, la caja vino aplastada y el frasco rajado',
    hilo: ['Cliente: hola llegó mi pedido', 'Nosotros: qué bueno, ¿todo bien?', 'Cliente: no'],
    hayPedido: true,
    db: {} as never,
    workspaceId: 'w1',
  }
  beforeEach(() => {
    jev.llamadas = 0
    haiku.llamadas = 0
    jev.hay = true
    haiku.linea = 'Llegó con la caja aplastada y el frasco rajado'
  })
  afterEach(() => {
    jev.respuesta = null
  })

  it('Jev decide y Haiku escribe la línea sólo si hay escalada', async () => {
    jev.respuesta = respuestas({ problema_en_curso: noul(0.98), clase: choice('devolucion'), urgencia: choice('hoy') })
    await expect(detectarEscalada(ctx)).resolves.toEqual({
      clase: 'devolucion',
      urgencia: 'hoy',
      porQue: 'Llegó con la caja aplastada y el frasco rajado',
    })
    expect(jev.llamadas).toBe(1)
    expect(haiku.llamadas).toBe(1)
  })

  it('sin escalada no se le pide nada a Haiku', async () => {
    jev.respuesta = respuestas()
    await expect(detectarEscalada({ ...ctx, mensaje: '¿y sirve para piel grasa?' })).resolves.toBeNull()
    expect(jev.llamadas).toBe(1)
    expect(haiku.llamadas).toBe(0)
  })

  it('si Haiku no escribe la línea, va la fija de la clase y el aviso sale igual', async () => {
    jev.respuesta = respuestas({ destino_distinto: noul(0.97), clase: choice('envio_mal'), urgencia: choice('ahora') })
    haiku.linea = null
    await expect(detectarEscalada(ctx)).resolves.toEqual({
      clase: 'envio_mal',
      urgencia: 'ahora',
      porQue: 'El envío parece ir a una dirección o ciudad incorrecta',
    })
  })

  it('si Jev no contesta, no se escala y no se cae a Haiku para decidir', async () => {
    jev.respuesta = null
    await expect(detectarEscalada(ctx)).resolves.toBeNull()
    expect(haiku.llamadas).toBe(0)
  })

  it('un botón de la recuperación no es un incidente ni paga una llamada', async () => {
    jev.respuesta = respuestas({ pide_fuera_de_alcance: noul(0.63) })
    await expect(detectarEscalada({ ...ctx, mensaje: 'MANTENER CONTRAENTREGA' })).resolves.toBeNull()
    await expect(detectarEscalada({ ...ctx, mensaje: 'Confirmar' })).resolves.toBeNull()
    expect(jev.llamadas).toBe(0)
  })

  it('una conversación suelta no paga ninguna llamada', async () => {
    jev.respuesta = respuestas({ problema_en_curso: noul(0.99) })
    await expect(
      detectarEscalada({ ...ctx, hilo: ['Cliente: hola'], hayPedido: false }),
    ).resolves.toBeNull()
    expect(jev.llamadas).toBe(0)
  })
})
