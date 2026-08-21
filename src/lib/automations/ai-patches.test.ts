import { describe, it, expect } from 'vitest'

import {
  aplicarPatches,
  ensayarPatches,
  esPatch,
  leerPatches,
  listarRutas,
  type AutomatizacionSnapshot,
  type PatchAutomatizacion,
} from './ai-patches'

/**
 * Editar es más peligroso que crear.
 *
 * Crear deja algo pausado que alguien va a mirar antes de prenderlo. Editar
 * toca una automatización que puede estar activa AHORA escribiéndole a gente:
 * un paso que se cae, una espera que se va a cero o un disparador sin su umbral
 * no fallan con un cartel, fallan callados. Estas pruebas son sobre eso.
 */

const rescate = (): AutomatizacionSnapshot => ({
  nombre: 'Rescate de carrito',
  disparador: 'shopify_abandoned_checkout',
  triggerConfig: {},
  pasos: [
    { id: 'p1', step_type: 'wait', step_config: { amount: 15, unit: 'minutes' } },
    {
      id: 'p2',
      step_type: 'send_message',
      step_config: { text: 'Te quedó algo en el carrito.' },
    },
    {
      id: 'p3',
      step_type: 'condition',
      step_config: { subject: 'order_paid', operand: '' },
      branches: {
        yes: [
          {
            id: 'p4',
            step_type: 'add_tag',
            step_config: { tag_id: '11111111-1111-1111-1111-111111111111' },
          },
        ],
        no: [{ id: 'p5', step_type: 'send_message', step_config: { text: '¿Te ayudo?' } }],
      },
    },
  ],
})

describe('esPatch', () => {
  it('acepta las seis operaciones bien formadas', () => {
    const buenos: PatchAutomatizacion[] = [
      { op: 'renombrar', nombre: 'Otro' },
      { op: 'cambiar_disparador', disparador: 'shopify_order_paid' },
      { op: 'cambiar_texto', paso: '2', texto: 'hola' },
      { op: 'cambiar_espera', paso: '1', cantidad: 2, unidad: 'hours' },
      { op: 'agregar_paso', nuevo: { tipo: 'close_conversation' } },
      { op: 'quitar_paso', paso: '3.si.1' },
    ]
    for (const p of buenos) expect(esPatch(p), JSON.stringify(p)).toBe(true)
  })

  it('rechaza lo que dejaría un cambio fantasma', () => {
    // Todos estos, aplicados, no harían nada: una `op` que el switch no conoce
    // se salta en silencio y el modelo diría que cambió algo que quedó igual.
    expect(esPatch({ op: 'mover_paso', paso: '1' })).toBe(false)
    expect(esPatch({ op: 'cambiar_texto', paso: 'segundo', texto: 'hola' })).toBe(false)
    expect(esPatch({ op: 'cambiar_texto', paso: '0', texto: 'hola' })).toBe(false)
    expect(esPatch({ op: 'cambiar_espera', paso: '1', cantidad: 2, unidad: 'semanas' })).toBe(false)
    expect(esPatch({ op: 'cambiar_disparador', disparador: 'cuando_quiera' })).toBe(false)
    expect(esPatch({ op: 'renombrar', nombre: '   ' })).toBe(false)
    expect(esPatch(null)).toBe(false)
  })

  it('leerPatches separa los buenos y cuenta los descartados', () => {
    const { patches, descartados } = leerPatches([
      { op: 'renombrar', nombre: 'Nuevo' },
      { op: 'inventada' },
    ])
    expect(patches).toHaveLength(1)
    expect(descartados).toBe(1)
  })
})

describe('rutas', () => {
  it('numera el tronco desde 1 y las ramas con si/no', () => {
    expect(listarRutas(rescate().pasos).map((p) => p.ruta)).toEqual([
      '1',
      '2',
      '3',
      '3.si.1',
      '3.no.1',
    ])
  })

  it('traduce el uuid de una etiqueta a su nombre', () => {
    const rutas = listarRutas(
      rescate().pasos,
      new Map([['11111111-1111-1111-1111-111111111111', 'comprador']]),
    )
    expect(rutas.find((r) => r.ruta === '3.si.1')?.que).toBe('Le pone la etiqueta «comprador»')
  })
})

describe('aplicarPatches', () => {
  it('cambia el texto de un mensaje sin tocar el resto', () => {
    const antes = rescate()
    const { despues, problemas } = aplicarPatches(antes, [
      { op: 'cambiar_texto', paso: '2', texto: 'Te dejamos el carrito listo.' },
    ])
    expect(problemas).toEqual([])
    expect(despues.pasos[1].step_config.text).toBe('Te dejamos el carrito listo.')
    // El id se conserva: es lo que hace que una corrida dormida en la espera de
    // arriba vuelva a este paso y no al tronco.
    expect(despues.pasos[1].id).toBe('p2')
    expect(despues.pasos[0].step_config).toEqual({ amount: 15, unit: 'minutes' })
    // Y el original no se toca: se trabaja sobre una copia.
    expect(antes.pasos[1].step_config.text).toBe('Te quedó algo en el carrito.')
  })

  it('agrega un paso al medio y corre los de abajo', () => {
    const { despues, problemas, resumen } = aplicarPatches(rescate(), [
      { op: 'agregar_paso', donde: '2', nuevo: { tipo: 'wait', cantidad: 1, unidad: 'days' } },
    ])
    expect(problemas).toEqual([])
    expect(despues.pasos.map((p) => p.step_type)).toEqual([
      'wait',
      'wait',
      'send_message',
      'condition',
    ])
    expect(resumen[0]).toContain('en la posición 2')
  })

  it('agrega al final de una rama', () => {
    const { despues, problemas } = aplicarPatches(rescate(), [
      { op: 'agregar_paso', donde: '3.no', nuevo: { tipo: 'close_conversation' } },
    ])
    expect(problemas).toEqual([])
    expect(despues.pasos[2].branches?.no?.map((p) => p.step_type)).toEqual([
      'send_message',
      'close_conversation',
    ])
  })

  it('quita el último paso y dice qué se llevó', () => {
    const { despues, problemas, resumen } = aplicarPatches(rescate(), [
      { op: 'quitar_paso', paso: '3' },
    ])
    expect(problemas).toEqual([])
    expect(despues.pasos.map((p) => p.step_type)).toEqual(['wait', 'send_message'])
    // Una condición se lleva sus ramas puestas, y eso hay que decirlo antes de
    // aprobar: son dos pasos más que desaparecen sin que nadie los nombrara.
    expect(resumen[0]).toContain('2 paso(s) de sus ramas')
  })

  it('los patches se aplican en orden, uno sobre el resultado del anterior', () => {
    const { despues, problemas } = aplicarPatches(rescate(), [
      { op: 'quitar_paso', paso: '1' },
      { op: 'cambiar_texto', paso: '1', texto: 'Ahora soy el primero.' },
    ])
    expect(problemas).toEqual([])
    expect(despues.pasos[0].step_config.text).toBe('Ahora soy el primero.')
  })

  it('no cambia el texto de un paso que manda una plantilla', () => {
    const snapshot = rescate()
    snapshot.pasos[1] = {
      id: 'p2',
      step_type: 'send_template',
      step_config: { template_name: 'carrito_abandonado' },
    }
    const { despues, problemas } = aplicarPatches(snapshot, [
      { op: 'cambiar_texto', paso: '2', texto: 'otra cosa' },
    ])
    expect(problemas).toHaveLength(1)
    expect(problemas[0].message).toContain('plantilla aprobada')
    // Lo importante no es el mensaje sino que no se escribió un `text` que el
    // motor ignora: el comercio habría jurado que cambió el mensaje.
    expect(despues.pasos[1].step_config.text).toBeUndefined()
  })

  it('una ruta que no existe se rechaza en vez de crear el paso', () => {
    const { problemas } = aplicarPatches(rescate(), [
      { op: 'cambiar_espera', paso: '9', cantidad: 1, unidad: 'days' },
    ])
    expect(problemas).toHaveLength(1)
    expect(problemas[0].message).toContain('no existe el paso 9')
  })

  it('un paso nuevo incompleto no entra a medias', () => {
    const { despues, problemas } = aplicarPatches(rescate(), [
      // Una espera sin unidad: el motor no sabría cuánto esperar.
      { op: 'agregar_paso', nuevo: { tipo: 'wait', cantidad: 3 } },
    ])
    expect(problemas).toHaveLength(1)
    expect(despues.pasos).toHaveLength(3)
  })

  it('un paso que el vocabulario del Operador no cubre sobrevive a la edición', () => {
    const snapshot = rescate()
    snapshot.pasos.push({
      id: 'p9',
      step_type: 'voice_call',
      step_config: { agent_id: 'a1' },
    })
    const { despues } = aplicarPatches(snapshot, [
      { op: 'cambiar_texto', paso: '2', texto: 'nuevo' },
    ])
    // Si la edición pasara por reconstruir el árbol desde lo que el modelo sabe
    // describir, este paso desaparecería sin que nadie lo pidiera.
    expect(despues.pasos[3]).toEqual({
      id: 'p9',
      step_type: 'voice_call',
      step_config: { agent_id: 'a1' },
    })
  })
})

describe('ensayo', () => {
  it('deja pasar una edición que no rompe nada', () => {
    const { erroresNuevos, problemas } = ensayarPatches(rescate(), [
      { op: 'cambiar_espera', paso: '1', cantidad: 2, unidad: 'hours' },
    ])
    expect(problemas).toEqual([])
    expect(erroresNuevos).toEqual([])
  })

  it('frena la que dejaría la automatización sin poder prenderse', () => {
    // Quitar los tres pasos la deja activa y sin nada que hacer: no falla, no
    // avisa, simplemente no vuelve a correr nunca.
    const { erroresNuevos } = ensayarPatches(rescate(), [
      { op: 'quitar_paso', paso: '3' },
      { op: 'quitar_paso', paso: '2' },
      { op: 'quitar_paso', paso: '1' },
    ])
    expect(erroresNuevos).toHaveLength(1)
    expect(erroresNuevos[0].message).toContain('at least one step')
  })

  it('frena un disparador nuevo al que le falta su umbral', () => {
    const { erroresNuevos } = ensayarPatches(rescate(), [
      { op: 'cambiar_disparador', disparador: 'customer_inactive' },
    ])
    expect(erroresNuevos.some((i) => i.path === 'trigger.days_threshold')).toBe(true)
  })

  it('el mismo disparador con sus días pasa', () => {
    const { erroresNuevos, despues } = ensayarPatches(rescate(), [
      { op: 'cambiar_disparador', disparador: 'customer_inactive', dias: 45 },
    ])
    expect(erroresNuevos).toEqual([])
    expect(despues.triggerConfig).toEqual({ days_threshold: 45 })
  })

  it('no culpa a la edición por lo que ya estaba roto', () => {
    // Una automatización recién instalada desde una receta viene con la
    // plantilla en blanco a propósito. Si eso frenara la edición, no habría
    // forma de completarla desde el chat.
    const rota: AutomatizacionSnapshot = {
      nombre: 'Recién instalada',
      disparador: 'shopify_abandoned_checkout',
      triggerConfig: {},
      pasos: [
        { id: 'x1', step_type: 'send_template', step_config: { template_name: '' } },
        { id: 'x2', step_type: 'wait', step_config: { amount: 1, unit: 'days' } },
      ],
    }
    const { erroresNuevos, problemas } = ensayarPatches(rota, [
      { op: 'agregar_paso', donde: '1', nuevo: { tipo: 'wait', cantidad: 30, unidad: 'minutes' } },
    ])
    expect(problemas).toEqual([])
    // El error viejo se corrió de `steps[0]` a `steps[1]` y aun así no cuenta
    // como nuevo: por eso la comparación es por mensaje y no por ruta.
    expect(erroresNuevos).toEqual([])
  })

  it('una etiqueta agregada por nombre no cuenta como error', () => {
    // El uuid se lo pone `resolverEtiquetas` recién al guardar.
    const { erroresNuevos } = ensayarPatches(rescate(), [
      { op: 'agregar_paso', nuevo: { tipo: 'add_tag', etiqueta: 'rescatado' } },
    ])
    expect(erroresNuevos).toEqual([])
  })

  it('no revalida una edición que ya venía rota', () => {
    const { problemas, erroresNuevos } = ensayarPatches(rescate(), [
      { op: 'quitar_paso', paso: '7' },
    ])
    expect(problemas).toHaveLength(1)
    expect(erroresNuevos).toEqual([])
  })

  it('corta si son demasiados cambios de una vez', () => {
    const muchos = Array.from({ length: 21 }, () => ({
      op: 'renombrar' as const,
      nombre: 'x',
    }))
    const { problemas, despues } = ensayarPatches(rescate(), muchos)
    expect(problemas[0].path).toBe('patches')
    expect(despues.nombre).toBe('Rescate de carrito')
  })
})
