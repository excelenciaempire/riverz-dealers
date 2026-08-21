import { describe, it, expect } from 'vitest'

import { CONDITION_SUBJECTS } from '@/types'
import { planDesdeIA, contarPasos, type AiPaso } from './ai-steps'
import type { BuilderStepInput } from './steps-tree'

/**
 * Lo que el Operador dice que quiere armar, contra lo que se puede armar.
 *
 * Esta traducción es la puerta entre un modelo y la base de datos. Sin ella,
 * un `step_type` inventado o una espera sin unidad se guardan sin quejarse y
 * fallan después, en cada corrida, con un error críptico en los registros —
 * cuando la automatización ya está prendida y escribiéndole a gente.
 *
 * La mitad de las pruebas de acá abajo son regresiones de una automatización
 * real: se creó en la cuenta de un comercio, se guardó sin una sola queja, y no
 * podía funcionar. Cada una nombra qué parte de eso congela.
 */

const ok = {
  nombre: 'Aviso de demora',
  disparador: 'shopify_order_fulfilled',
  pasos: [
    { tipo: 'wait', cantidad: 3, unidad: 'days' },
    { tipo: 'send_message', texto: 'Hola {{vars.customer_name}}, tu pedido va en camino.' },
    { tipo: 'add_tag', etiqueta: 'aviso-demora' },
  ],
}

/** Recorre el árbol entero, ramas incluidas. */
function todos(pasos: BuilderStepInput[]): BuilderStepInput[] {
  return pasos.flatMap((p) => [
    p,
    ...todos(p.branches?.yes ?? []),
    ...todos(p.branches?.no ?? []),
  ])
}

describe('planDesdeIA', () => {
  it('traduce un plan completo', () => {
    const { plan, problemas } = planDesdeIA(ok)
    expect(problemas).toEqual([])
    expect(plan?.nombre).toBe('Aviso de demora')
    expect(plan?.pasos.map((p) => p.step_type)).toEqual(['wait', 'send_message', 'add_tag'])
    // La etiqueta viaja en `tag_name` y NO en `tag_id`: es el campo que
    // `resolverReferencias` busca para crearla en la cuenta y poner el uuid. En
    // `tag_id` el nombre queda donde va un id y la automatización no se puede
    // prender nunca.
    expect(plan?.pasos[2].step_config).toEqual({ tag_name: 'aviso-demora' })
  })

  it('rechaza un disparador que no existe', () => {
    const { plan, problemas } = planDesdeIA({ ...ok, disparador: 'cuando_quiera' })
    expect(plan).toBeNull()
    expect(problemas.some((p) => p.path === 'disparador')).toBe(true)
  })

  it('rechaza un paso incompleto en vez de guardarlo a medias', () => {
    // Una espera sin unidad se guardaba y después el motor no sabía cuánto
    // esperar.
    const { plan, problemas } = planDesdeIA({ ...ok, pasos: [{ tipo: 'wait', cantidad: 3 }] })
    expect(plan).toBeNull()
    expect(problemas.some((p) => p.path.endsWith('.unidad'))).toBe(true)
  })

  it('descarta un tipo de paso que no existe, y dice cuáles hay', () => {
    const { plan, problemas } = planDesdeIA({
      ...ok,
      pasos: [{ tipo: 'mandar_paloma', texto: 'hola' }],
    })
    expect(plan).toBeNull()
    expect(problemas[0].message).toContain('send_message')
  })

  it('no deja crear una automatización sin pasos', () => {
    expect(planDesdeIA({ ...ok, pasos: [] }).plan).toBeNull()
  })

  it('exige nombre', () => {
    const { plan, problemas } = planDesdeIA({ ...ok, nombre: '   ' })
    expect(plan).toBeNull()
    expect(problemas.some((p) => p.path === 'nombre')).toBe(true)
  })
})

describe('las preguntas se eligen de una lista, no se escriben', () => {
  it('«tag» no se puede escribir, y el error dice cuál era', () => {
    // LA regresión. Esto es exactamente lo que se guardó en una cuenta real:
    // el modelo escribió `subject: "tag"`, que no existe, el motor cae a su
    // `default: return false` y las tres preguntas dieron siempre que no. La
    // automatización entera no le escribió nunca a nadie, sin un error en
    // ningún lado.
    const { plan, problemas } = planDesdeIA({
      ...ok,
      pasos: [
        {
          tipo: 'condition',
          dato: 'tag',
          etiqueta: 'unidades: 1',
          si: [{ tipo: 'close_conversation' }],
        },
      ],
    })
    expect(plan).toBeNull()
    expect(problemas[0].message).toContain('has_tag')
  })

  it('la etiqueta de una pregunta viaja por nombre, para convertirse en id', () => {
    const { plan, problemas } = planDesdeIA({
      ...ok,
      pasos: [
        {
          tipo: 'condition',
          dato: 'has_tag',
          etiqueta: 'comprador',
          si: [{ tipo: 'close_conversation' }],
          no: [{ tipo: 'send_message', texto: 'Hola' }],
        },
      ],
    })
    expect(problemas).toEqual([])
    expect(plan?.pasos[0].step_config).toMatchObject({
      subject: 'tag_presence',
      operand: '',
      tag_name: 'comprador',
    })
  })

  it('un dato que ese disparador no trae se rechaza, no se guarda muerto', () => {
    // `offer_units` sale del webhook de un pedido: en una automatización por
    // inactividad no existe, y la pregunta daría siempre que no.
    const { plan, problemas } = planDesdeIA({
      nombre: 'Recompra',
      disparador: 'customer_inactive',
      dias: 45,
      pasos: [
        {
          tipo: 'condition',
          dato: 'offer_units',
          comparador: 'gte',
          valor: '3',
          si: [{ tipo: 'close_conversation' }],
        },
      ],
    })
    expect(plan).toBeNull()
    expect(problemas[0].message).toContain('customer_inactive')
  })

  it('una pregunta de sí o no no admite mayor ni menor', () => {
    const { plan, problemas } = planDesdeIA({
      ...ok,
      pasos: [
        {
          tipo: 'condition',
          dato: 'has_tag',
          etiqueta: 'x',
          comparador: 'gte',
          si: [{ tipo: 'close_conversation' }],
        },
      ],
    })
    expect(plan).toBeNull()
    expect(problemas[0].path).toContain('comparador')
  })

  it('una pregunta sin nada en ninguna rama no es una pregunta', () => {
    // El motor la acepta y sigue de largo sin decir nada, así que sin este
    // corte queda un paso decorativo que nadie nota.
    const { plan, problemas } = planDesdeIA({
      ...ok,
      pasos: [{ tipo: 'condition', dato: 'has_tag', etiqueta: 'x', si: [], no: [] }],
    })
    expect(plan).toBeNull()
    expect(problemas.some((p) => p.message.includes('ni con el sí'))).toBe(true)
  })

  it('todo lo que sale tiene un sujeto que el motor sabe contestar', () => {
    const { plan } = planDesdeIA({
      ...ok,
      pasos: [
        {
          tipo: 'condition',
          dato: 'has_tag',
          etiqueta: 'x',
          si: [
            {
              tipo: 'condition',
              dato: 'last_offer_units',
              comparador: 'gte',
              valor: '3',
              si: [{ tipo: 'close_conversation' }],
            },
          ],
          no: [{ tipo: 'close_conversation' }],
        },
      ],
    })
    const condiciones = todos(plan!.pasos).filter((p) => p.step_type === 'condition')
    expect(condiciones.length).toBe(2)
    for (const c of condiciones) {
      expect(CONDITION_SUBJECTS).toContain(
        (c.step_config as { subject: string }).subject,
      )
    }
  })
})

describe('las preguntas que se contestan solas', () => {
  it('«¿ya está pagado?» justo después de «se pagó un pedido»', () => {
    const { plan, problemas } = planDesdeIA({
      nombre: 'Post pago',
      disparador: 'shopify_order_paid',
      pasos: [
        { tipo: 'condition', dato: 'order_paid', si: [{ tipo: 'close_conversation' }] },
      ],
    })
    expect(plan).toBeNull()
    expect(problemas[0].message).toContain('siempre que sí')
  })

  it('«¿volvió a comprar desde que arrancó?» sin una espera antes', () => {
    const { plan, problemas } = planDesdeIA({
      nombre: 'Recompra',
      disparador: 'shopify_order_paid',
      pasos: [
        {
          tipo: 'condition',
          dato: 'purchased',
          ventana: 'since_trigger',
          no: [{ tipo: 'send_message', texto: 'Hola' }],
        },
      ],
    })
    expect(plan).toBeNull()
    expect(problemas[0].message).toContain('siempre que no')
  })

  it('con la espera antes, la misma pregunta pasa', () => {
    const { plan, problemas } = planDesdeIA({
      nombre: 'Recompra',
      disparador: 'shopify_order_paid',
      pasos: [
        { tipo: 'wait', cantidad: 15, unidad: 'days' },
        {
          tipo: 'condition',
          dato: 'purchased',
          ventana: 'since_trigger',
          no: [{ tipo: 'send_message', texto: 'Hola' }],
        },
      ],
    })
    expect(problemas).toEqual([])
    expect(plan?.pasos[1].step_config).toMatchObject({
      subject: 'purchased',
      operand: 'since_trigger',
      value: 'true',
    })
  })
})

describe('las variables de un mensaje', () => {
  it('rechaza las que el motor deja vacías', () => {
    // El esquema viejo enseñaba a escribir {{nombre}}, y el motor sólo entiende
    // {{vars.X}}: "Hola {{nombre}}" salía como "Hola ".
    const { plan, problemas } = planDesdeIA({
      ...ok,
      pasos: [{ tipo: 'send_message', texto: 'Hola {{nombre}}' }],
    })
    expect(plan).toBeNull()
    expect(problemas[0].message).toContain('{{vars.customer_name}}')
  })

  it('acepta las que sí existen', () => {
    const { problemas } = planDesdeIA({
      ...ok,
      pasos: [{ tipo: 'send_message', texto: 'Hola {{vars.customer_name}}, {{message.text}}' }],
    })
    expect(problemas).toEqual([])
  })
})

describe('el disparador y lo que necesita', () => {
  it('por inactividad, sin los días, no se puede', () => {
    // Y esto NUNCA se pudo: `crear` guardaba `trigger_config: {}` fijo, así que
    // la validación pedía los días y el modelo no tenía dónde ponerlos. Lo que
    // veía el comercio era "days since last order must be greater than 0".
    const { plan, problemas } = planDesdeIA({
      nombre: 'Recompra',
      disparador: 'customer_inactive',
      pasos: [{ tipo: 'send_message', texto: 'Hola' }],
    })
    expect(plan).toBeNull()
    expect(problemas.some((p) => p.path === 'dias')).toBe(true)
  })

  it('con los días, la configuración queda armada', () => {
    const { plan, problemas } = planDesdeIA({
      nombre: 'Recompra',
      disparador: 'customer_inactive',
      dias: 45,
      pasos: [{ tipo: 'send_message', texto: 'Hola' }],
    })
    expect(problemas).toEqual([])
    expect(plan?.disparadorConfig).toEqual({ days_threshold: 45 })
  })
})

describe('el árbol', () => {
  it('cuenta los pasos de las ramas, no sólo los de la raíz', () => {
    // La vista previa decía "1 paso(s)" sobre una automatización de dieciséis.
    const { plan } = planDesdeIA({
      ...ok,
      pasos: [
        {
          tipo: 'condition',
          dato: 'has_tag',
          etiqueta: 'x',
          si: [{ tipo: 'close_conversation' }],
          no: [{ tipo: 'send_message', texto: 'Hola' }, { tipo: 'close_conversation' }],
        },
      ],
    })
    expect(plan?.pasos.length).toBe(1)
    expect(plan?.total).toBe(4)
    expect(contarPasos(plan!.pasos)).toBe(4)
  })

  it('corta cuando se encadenan demasiadas preguntas', () => {
    const hoja = { tipo: 'close_conversation' }
    const anidar = (n: number): AiPaso =>
      n === 0
        ? hoja
        : { tipo: 'condition', dato: 'has_tag', etiqueta: 'x', si: [anidar(n - 1)], no: [hoja] }
    const { plan, problemas } = planDesdeIA({ ...ok, pasos: [anidar(5)] })
    expect(plan).toBeNull()
    expect(problemas.some((p) => p.message.includes('encadenadas'))).toBe(true)
    // Cuatro sí entran: es la profundidad que necesita el caso de recompra por
    // volumen, que con el límite viejo de uno era imposible de expresar.
    expect(planDesdeIA({ ...ok, pasos: [anidar(4)] }).problemas).toEqual([])
  })
})
