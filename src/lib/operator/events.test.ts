import { describe, it, expect } from 'vitest'

import { drainEvents, encodeEvent, type OperatorEvent } from './events'

/**
 * El troceo del stream.
 *
 * Un chunk de red corta donde se le da la gana: en la mitad de una línea, en la
 * mitad de una palabra, y con UTF-8 hasta en la mitad de una letra. Si el
 * parser no guarda lo que quedó a medias, la primera tilde partida en dos
 * chunks se lleva puesto ese evento — y como los eventos son "creó tal cosa",
 * lo que se pierde es justamente lo que el comercio tenía que ver.
 */
describe('drainEvents', () => {
  it('devuelve los eventos completos y guarda el resto', () => {
    const { events, rest } = drainEvents('{"t":"text","delta":"hola"}\n{"t":"te')
    expect(events).toEqual([{ t: 'text', delta: 'hola' }])
    expect(rest).toBe('{"t":"te')
  })

  it('un evento partido en dos chunks se arma bien', () => {
    const a = drainEvents('{"t":"text","del')
    expect(a.events).toEqual([])
    const b = drainEvents(a.rest + 'ta":"ñandú"}\n')
    expect(b.events).toEqual([{ t: 'text', delta: 'ñandú' }])
    expect(b.rest).toBe('')
  })

  it('varios eventos en un solo chunk salen en orden', () => {
    const linea = (e: OperatorEvent) => encodeEvent(e)
    const buf =
      linea({ t: 'tool_start', id: '1', key: 'metricas.resumen', label: 'Métricas' }) +
      linea({ t: 'tool_done', id: '1', key: 'metricas.resumen', ok: true, resumen: '9' }) +
      linea({ t: 'done', thread: 'abc' })
    const { events, rest } = drainEvents(buf)
    expect(events.map((e) => e.t)).toEqual(['tool_start', 'tool_done', 'done'])
    expect(rest).toBe('')
  })

  it('una línea ilegible no se lleva puesto el resto del turno', () => {
    const { events } = drainEvents('{roto\n{"t":"done","thread":"x"}\n')
    expect(events).toEqual([{ t: 'done', thread: 'x' }])
  })

  it('las líneas vacías se ignoran', () => {
    const { events } = drainEvents('\n\n{"t":"done","thread":"x"}\n\n')
    expect(events).toHaveLength(1)
  })
})

describe('la regla que impide que se mezcle el texto de dos agentes', () => {
  it('lo que dice un subagente va por su canal, con su nombre', () => {
    // Si un subagente emitiera `text`, sus frases se pegarían dentro del mismo
    // párrafo del hilo: la pantalla acumula los deltas en el último bloque, sin
    // saber quién los dijo. Con dos o tres trabajando a la vez, el resultado es
    // una respuesta ilegible y sin dueño.
    const buf =
      encodeEvent({ t: 'agente_dice', agente: 'plantillas', texto: 'Escribo la plantilla' }) +
      encodeEvent({ t: 'agente_dice', agente: 'contactos', texto: 'Cuento el público' }) +
      encodeEvent({ t: 'text', delta: 'Listo, quedaron dos cosas.' })
    const { events } = drainEvents(buf)

    const delEquipo = events.filter((e) => e.t === 'agente_dice')
    expect(delEquipo).toHaveLength(2)
    expect(delEquipo.every((e) => 'agente' in e && !!e.agente)).toBe(true)

    // El único `text` del turno es el del orquestador, y no lleva agente.
    const delHilo = events.filter((e) => e.t === 'text')
    expect(delHilo).toHaveLength(1)
    expect('agente' in delHilo[0]).toBe(false)
  })

  it('un latido no dice nada y no rompe a nadie', () => {
    // Existe sólo para que el canal no quede mudo mientras un subagente
    // trabaja: un NDJSON callado es indistinguible de una conexión cortada.
    const { events } = drainEvents(
      encodeEvent({ t: 'latido' }) + encodeEvent({ t: 'done', thread: 'x' }),
    )
    expect(events.map((e) => e.t)).toEqual(['latido', 'done'])
  })

  it('el plan viaja entero, con sus dependencias', () => {
    // Es lo que se aprueba de una vez: si llegara a medias, la persona
    // aprobaría algo distinto de lo que va a correr.
    const buf = encodeEvent({
      t: 'plan',
      planId: 'p1',
      porque: 'la automatización necesita la plantilla',
      pasos: [
        { i: 0, agente: 'plantillas', que: 'Escribe el mensaje', encargo: 'Escribí la de carrito', dependeDe: [] },
        { i: 1, agente: 'automatizaciones', que: 'Arma el rescate', encargo: 'Armá el rescate', dependeDe: [0] },
      ],
    })
    const { events } = drainEvents(buf)
    const plan = events[0]
    if (plan.t !== 'plan') throw new Error('tipo inesperado')
    expect(plan.pasos).toHaveLength(2)
    expect(plan.pasos[1].dependeDe).toEqual([0])
  })
})

describe('encodeEvent', () => {
  it('cada evento termina en un salto y no lleva otros adentro', () => {
    // El salto es el separador: un evento con un salto en el medio partiría en
    // dos líneas ilegibles. `JSON.stringify` lo escapa, y esto lo fija.
    const s = encodeEvent({ t: 'text', delta: 'una\nlínea' })
    expect(s.endsWith('\n')).toBe(true)
    expect(s.slice(0, -1).includes('\n')).toBe(false)
    expect(drainEvents(s).events).toEqual([{ t: 'text', delta: 'una\nlínea' }])
  })
})
