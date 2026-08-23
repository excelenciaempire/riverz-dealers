import { describe, expect, it } from 'vitest'

import { plegar } from './lienzo-automatizacion'
import type { PasoArtefacto } from '@/lib/operator/artifacts'

/**
 * Que el chat y el editor dibujen la MISMA automatización.
 *
 * El editor pliega una cadena de preguntas sobre lo mismo en una sola tarjeta
 * «Condición» con N caminos (`collapseSwitch`). El chat las dibujaba
 * encadenadas, cada una escondida dentro del NO de la anterior, así que la
 * misma automatización se veía distinta en los dos lados. Estas pruebas fijan
 * la regla de plegado con la misma condición que allá: se pliega mientras cada
 * camino sea una lista plana.
 */

const paso = (tipo: string, resumen = tipo): PasoArtefacto => ({ tipo, resumen })

/** Tres «¿tiene la etiqueta X?» encadenadas por el NO, como la de recompra. */
const cadena: PasoArtefacto = {
  tipo: 'condition',
  resumen: '¿Tiene la etiqueta «unidades: 1»?',
  si: [paso('wait', 'Espera 7 días'), paso('send_template', 'Plantilla recompra_1')],
  no: [
    {
      tipo: 'condition',
      resumen: '¿Tiene la etiqueta «unidades: 2-3»?',
      si: [paso('wait', 'Espera 15 días'), paso('send_template', 'Plantilla recompra_2')],
      no: [
        {
          tipo: 'condition',
          resumen: '¿Tiene la etiqueta «unidades: 4+»?',
          si: [paso('wait', 'Espera 15 días'), paso('send_template', 'Plantilla recompra_3')],
          no: [],
        },
      ],
    },
  ],
}

describe('plegar una cadena de preguntas', () => {
  it('tres encadenadas son una tarjeta de tres caminos', () => {
    const p = plegar(cadena)
    expect(p).not.toBeNull()
    expect(p!.caminos.map((c) => c.pregunta)).toEqual([
      '¿Tiene la etiqueta «unidades: 1»?',
      '¿Tiene la etiqueta «unidades: 2-3»?',
      '¿Tiene la etiqueta «unidades: 4+»?',
    ])
    expect(p!.otroCaso).toEqual([])
  })

  it('cada camino se lleva sus propios pasos', () => {
    const p = plegar(cadena)!
    expect(p.caminos.map((c) => c.pasos.length)).toEqual([2, 2, 2])
    expect(p.caminos[0].pasos[0].resumen).toBe('Espera 7 días')
  })

  it('una sola pregunta NO se pliega: es un sí/no y se dibuja como tal', () => {
    expect(
      plegar({
        tipo: 'condition',
        resumen: '¿Volvió a comprar?',
        si: [paso('close_conversation')],
        no: [paso('send_template')],
      }),
    ).toBeNull()
  })

  it('si un camino vuelve a ramificar, no se pliega y no se esconde ningún paso', () => {
    // La misma condición que pone el editor: `allLeaf`. Plegar acá dejaría
    // pasos dentro de una tarjeta que no los muestra.
    const conRamaAdentro: PasoArtefacto = {
      tipo: 'condition',
      resumen: '¿A?',
      si: [{ tipo: 'condition', resumen: '¿B?', si: [paso('close_conversation')], no: [] }],
      no: [{ tipo: 'condition', resumen: '¿C?', si: [paso('close_conversation')], no: [] }],
    }
    expect(plegar(conRamaAdentro)).toBeNull()
  })

  it('lo que no es una pregunta nunca se pliega', () => {
    expect(plegar(paso('wait', 'Espera 7 días'))).toBeNull()
  })

  it('el último NO, si tiene pasos, es el «en otro caso»', () => {
    const conOtro = JSON.parse(JSON.stringify(cadena)) as PasoArtefacto
    conOtro.no![0].no![0].no = [paso('close_conversation', 'Cierra la conversación')]
    const p = plegar(conOtro)!
    expect(p.caminos).toHaveLength(3)
    expect(p.otroCaso).toHaveLength(1)
  })
})
