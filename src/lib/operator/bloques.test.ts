import { describe, expect, it } from 'vitest'

import { aplicarEvento, aplicarEventoDePlan, grabador, type Bloque } from './bloques'
import type { OperatorEvent } from './events'

/**
 * El turno, armado del mismo modo en los dos lados.
 *
 * El navegador lo arma mientras pasa y el servidor lo arma para guardarlo. Con
 * dos copias de la lógica, el hilo se vería de una forma en vivo y de otra al
 * recargarlo, y nadie se enteraría hasta que alguien recargue.
 */

const correr = (eventos: OperatorEvent[]): Bloque[] =>
  eventos.reduce<Bloque[]>((b, e) => aplicarEvento(b, e), [])

describe('el turno', () => {
  it('junta los deltas de texto en un solo bloque', () => {
    const b = correr([
      { t: 'text', delta: 'Miro cómo ' },
      { t: 'text', delta: 'viene la cuenta.' },
    ])
    expect(b).toEqual([{ k: 'texto', id: 't0', texto: 'Miro cómo viene la cuenta.' }])
  })

  it('abre un bloque de texto nuevo después de un paso', () => {
    // Es lo que hace que "voy a mirar" quede ARRIBA de la consulta que anuncia
    // y no debajo.
    const b = correr([
      { t: 'text', delta: 'Miro.' },
      { t: 'tool_start', id: 'x', key: 'plantillas.estado', label: 'Reviso las plantillas' },
      { t: 'tool_done', id: 'x', key: 'plantillas.estado', ok: true, resumen: '3' },
      { t: 'text', delta: 'Hay tres.' },
    ])
    expect(b.map((x) => x.k)).toEqual(['texto', 'paso', 'texto'])
  })

  it('el paso se parchea en su lugar, no se duplica', () => {
    const b = correr([
      { t: 'tool_start', id: 'x', key: 'automatizaciones.crear', label: 'Armo la automatización' },
      {
        t: 'built',
        id: 'x',
        actionId: 'acc-1',
        key: 'automatizaciones.crear',
        preview: 'Creé «Recompra»',
      },
    ])
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ k: 'paso', estado: 'hecho', actionId: 'acc-1' })
  })

  it('un fallo deja el motivo a la vista, y un acierto no', () => {
    const [ok] = correr([
      { t: 'tool_start', id: 'a', key: 'k', label: 'L' },
      { t: 'tool_done', id: 'a', key: 'k', ok: true, resumen: '12' },
    ])
    const [mal] = correr([
      { t: 'tool_start', id: 'a', key: 'k', label: 'L' },
      { t: 'tool_done', id: 'a', key: 'k', ok: false, resumen: 'no hay tienda conectada' },
    ])
    expect(ok).toMatchObject({ estado: 'ok', detalle: undefined })
    expect(mal).toMatchObject({ estado: 'error', detalle: 'no hay tienda conectada' })
  })

  it('lo que no se dibuja en el hilo no lo toca', () => {
    const b = correr([
      { t: 'thinking', delta: 'mmm' },
      { t: 'latido' },
      { t: 'agente_inicio', agente: 'plantillas', encargo: 'escribí la plantilla' },
      { t: 'gasto', promptTokens: 1, completionTokens: 2, porAgente: {} },
    ])
    expect(b).toEqual([])
  })
})

describe('un plan aprobado', () => {
  it('abre el paso solo, porque nadie lo anunció antes', () => {
    // Corriendo un plan no hay `tool_start`: sin esto, `conPaso` no encontraba
    // a quién parchear y el paso no aparecía en ningún lado.
    const b = aplicarEventoDePlan([], {
      t: 'built',
      id: 'p1',
      actionId: 'acc-9',
      key: 'plantillas.crear_borrador',
      label: 'Escribo la plantilla',
      preview: 'Guardé el borrador «recompra»',
    })
    expect(b).toEqual([
      {
        k: 'paso',
        id: 'p1',
        key: 'plantillas.crear_borrador',
        label: 'Escribo la plantilla',
        estado: 'hecho',
        detalle: 'Guardé el borrador «recompra»',
        artefacto: undefined,
        actionId: 'acc-9',
      },
    ])
  })

  it('sin etiqueta cae a la clave, que es mejor que nada', () => {
    const [paso] = aplicarEventoDePlan([], {
      t: 'proposed',
      id: 'p1',
      actionId: 'a',
      key: 'mensajes.enviar',
      preview: 'x',
    })
    expect(paso).toMatchObject({ label: 'mensajes.enviar' })
  })
})

describe('el grabador del servidor', () => {
  it('deja el turno listo para guardarlo', () => {
    const g = grabador()
    for (const e of [
      { t: 'text', delta: 'Listo.' },
      { t: 'tool_start', id: 'x', key: 'k', label: 'L' },
      { t: 'tool_done', id: 'x', key: 'k', ok: true, resumen: '1' },
    ] as OperatorEvent[]) {
      g.ver(e)
    }
    expect(g.bloques.map((b) => b.k)).toEqual(['texto', 'paso'])
  })
})
