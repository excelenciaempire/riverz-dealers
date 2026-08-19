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
