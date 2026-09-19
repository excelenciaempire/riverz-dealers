import { describe, expect, it } from 'vitest'
import { leadDesdeJev } from './lead-scoring'
import { dmDesdeJev } from './dm-opportunity'
import { intencionDesdeJev, preguntaDeIntencion } from '@/lib/flows/ai-intent'

const noul = (n: number) => ({ type: 'noul' as const, noul: n })
// Sólo la opción elegida lleva probabilidad: alcanza para la política, que
// mira `choice` y `confidence`. El `never` es para no tener que escribir las
// seis opciones en cada caso.
const choice = <O extends string>(o: O, c = 0.9) =>
  ({ type: 'choice' as const, choice: o, probabilities: { [o]: c }, confidence: c }) as never

describe('leadDesdeJev', () => {
  it('traduce las tres respuestas al puntaje de siempre', () => {
    expect(
      leadDesdeJev({
        intencion: choice('high'),
        sentimiento: choice('positive'),
        spam: noul(0.05),
      }),
    ).toEqual({ score: 'high', sentiment: 'positive', spam: false })
  })

  it('el spam se pide claro: 0,7 o más', () => {
    expect(leadDesdeJev({ intencion: choice('low'), sentimiento: choice('negative'), spam: noul(0.69) }).spam).toBe(false)
    expect(leadDesdeJev({ intencion: choice('low'), sentimiento: choice('negative'), spam: noul(0.7) }).spam).toBe(true)
  })

  it('una respuesta que falta cae a neutro no-spam, como con Haiku', () => {
    expect(leadDesdeJev({})).toEqual({ score: 'low', sentiment: 'neutral', spam: false })
  })
})

describe('dmDesdeJev', () => {
  it('abre el privado con la razón que Jev eligió', () => {
    expect(dmDesdeJev({ razon: choice('pedido'), abrir_privado: noul(0.92) })).toEqual({ dm: true, reason: 'pedido' })
  })

  it('el sí o no manda sobre la razón: "ninguna" al 40% no abre nada', () => {
    expect(dmDesdeJev({ razon: choice('compra', 0.35), abrir_privado: noul(0.3) })).toEqual({ dm: false, reason: 'ninguna' })
  })

  it('si dice que sí pero la razón es "ninguna", queda como compra', () => {
    expect(dmDesdeJev({ razon: choice('ninguna', 0.4), abrir_privado: noul(0.8) })).toEqual({ dm: true, reason: 'compra' })
  })
})

describe('intención de un flujo', () => {
  const intents = [
    { intent_key: 'quiere_comprar', description: 'Quiere comprar o pregunta precio' },
    { intent_key: 'pregunta_envio', description: 'Pregunta por el envío' },
  ]

  it('las opciones son las del nodo más una salida de "ninguna"', () => {
    const q = preguntaDeIntencion(intents)
    expect(q.type).toBe('choice')
    expect(Object.keys(q.criteria)).toEqual(['quiere_comprar', 'pregunta_envio', '__ninguna__'])
  })

  it('devuelve la intención cuando Jev se inclina claro', () => {
    expect(intencionDesdeJev(choice('pregunta_envio', 0.8), intents)).toBe('pregunta_envio')
  })

  it('con poca confianza o "ninguna" se va por la rama de respaldo', () => {
    expect(intencionDesdeJev(choice('pregunta_envio', 0.3), intents)).toBeNull()
    expect(intencionDesdeJev(choice('__ninguna__', 0.9), intents)).toBeNull()
    expect(intencionDesdeJev(choice('inventada', 0.9), intents)).toBeNull()
  })
})
