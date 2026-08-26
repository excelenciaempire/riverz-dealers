import { describe, expect, it } from 'vitest'

import {
  agrupar,
  aplicarEvento,
  aplicarEventoDePlan,
  grabador,
  sinCondicional,
  type Bloque,
} from './bloques'
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

describe('cómo se cuenta lo que ya pasó', () => {
  it('un paso hecho pierde el condicional', () => {
    // El bug de confianza: el paso decía «Crearía» sobre una automatización que
    // ya estaba creada, y quien lo leyó pensó que no había aprobado nada.
    expect(
      sinCondicional('Crearía «Recompra por unidades»: cuando se pagó un pedido, 9 paso(s).'),
    ).toBe('«Recompra por unidades»: cuando se pagó un pedido, 9 paso(s).')
    expect(sinCondicional('Prendería «Recompra». Empieza a dispararse.')).toBe(
      '«Recompra». Empieza a dispararse.',
    )
  })

  it('no le toca nada a un texto que no empieza en condicional', () => {
    expect(sinCondicional('Ya no hay nada que hacer.')).toBe('Ya no hay nada que hacer.')
    expect(sinCondicional('María quería otra cosa')).toBe('María quería otra cosa')
  })

  /**
   * Y esta es la que faltaba.
   *
   * `sinCondicional` estaba escrita, probada y exportada — y no la llamaba
   * nadie. Una prueba de la funcion sola no dice si el texto llega limpio a la
   * pantalla; esta recorre el reductor, que es por donde pasa de verdad.
   */
  it('el reductor se lo saca al paso que quedó hecho', () => {
    const bs = aplicarEvento(
      [{ k: 'paso', id: 'x', key: 'automatizaciones.crear', label: 'Las automatizaciones', estado: 'corriendo' }],
      {
        t: 'built',
        id: 'x',
        actionId: 'a1',
        key: 'automatizaciones.crear',
        preview: 'Crearía «Recompra»: cuando se pagó un pedido, 9 pasos.',
      },
    )
    const paso = bs.find((b) => b.k === 'paso')
    expect(paso?.k === 'paso' && paso.detalle).toBe(
      '«Recompra»: cuando se pagó un pedido, 9 pasos.',
    )
  })

  it('pero se lo deja al que todavía espera aprobación', () => {
    const bs = aplicarEvento(
      [{ k: 'paso', id: 'y', key: 'plantillas.crear', label: 'Las plantillas', estado: 'corriendo' }],
      {
        t: 'proposed',
        id: 'y',
        actionId: 'a2',
        key: 'plantillas.crear',
        preview: 'Crearía «recompra_1»',
      },
    )
    const paso = bs.find((b) => b.k === 'paso')
    expect(paso?.k === 'paso' && paso.detalle).toBe('Crearía «recompra_1»')
  })
})

describe('los pasos repetidos', () => {
  const lectura = (id: string, key: string, estado: 'ok' | 'corriendo' = 'ok'): Bloque => ({
    k: 'paso',
    id,
    key,
    label: key,
    estado,
  })

  it('tres iguales seguidos se cuentan como uno', () => {
    // «Mirando las automatizaciones» tres veces en fila no cuenta tres cosas.
    const g = agrupar([
      lectura('a', 'automatizaciones.listar'),
      lectura('b', 'automatizaciones.listar'),
      lectura('c', 'automatizaciones.listar'),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].veces).toBe(3)
  })

  it('si una sigue corriendo, la fila sigue girando', () => {
    const g = agrupar([
      lectura('a', 'plantillas.estado'),
      lectura('b', 'plantillas.estado', 'corriendo'),
    ])
    expect(g[0].veces).toBe(2)
    expect(g[0].b.k === 'paso' && g[0].b.estado).toBe('corriendo')
  })

  it('lo que dejó algo en la cuenta nunca se junta', () => {
    // Ahí el detalle importa: dos cosas creadas son dos cosas.
    const construido = (id: string): Bloque => ({
      k: 'paso',
      id,
      key: 'segmentos.crear',
      label: 'x',
      estado: 'hecho',
      actionId: `acc-${id}`,
    })
    expect(agrupar([construido('a'), construido('b')])).toHaveLength(2)
  })

  it('no junta dos lecturas distintas', () => {
    expect(agrupar([lectura('a', 'plantillas.estado'), lectura('b', 'contactos.listar')])).toHaveLength(2)
  })

  it('no junta a través de un texto en el medio', () => {
    const g = agrupar([
      lectura('a', 'plantillas.estado'),
      { k: 'texto', id: 't0', texto: 'Hay tres.' },
      lectura('b', 'plantillas.estado'),
    ])
    expect(g).toHaveLength(3)
  })
})
