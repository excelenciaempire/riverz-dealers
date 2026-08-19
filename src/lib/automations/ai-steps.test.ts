import { describe, it, expect } from 'vitest'

import { planDesdeIA } from './ai-steps'

/**
 * Lo que el Operador dice que quiere armar, contra lo que se puede armar.
 *
 * Esta traducción es la puerta entre un modelo y la base de datos. Sin ella,
 * un `step_type` inventado o una espera sin unidad se guardan sin quejarse y
 * fallan después, en cada corrida, con un error críptico en los registros —
 * cuando la automatización ya está prendida y escribiéndole a gente.
 */

const ok = {
  nombre: 'Aviso de demora',
  disparador: 'shopify_order_fulfilled',
  pasos: [
    { tipo: 'wait', cantidad: 3, unidad: 'days' },
    { tipo: 'send_message', texto: 'Hola {{nombre}}, tu pedido va en camino.' },
    { tipo: 'add_tag', etiqueta: 'aviso-demora' },
  ],
}

describe('planDesdeIA', () => {
  it('traduce un plan completo', () => {
    const { plan, problemas } = planDesdeIA(ok)
    expect(problemas).toEqual([])
    expect(plan?.nombre).toBe('Aviso de demora')
    expect(plan?.pasos.map((p) => p.step_type)).toEqual([
      'wait',
      'send_message',
      'add_tag',
    ])
    // La etiqueta viaja por NOMBRE: el uuid lo resuelve la cuenta después.
    expect(plan?.pasos[2].step_config).toEqual({ tag_id: 'aviso-demora' })
  })

  it('rechaza un disparador que no existe', () => {
    const { plan, problemas } = planDesdeIA({ ...ok, disparador: 'cuando_quiera' })
    expect(plan).toBeNull()
    expect(problemas.some((p) => p.path === 'disparador')).toBe(true)
  })

  it('rechaza un paso incompleto en vez de guardarlo a medias', () => {
    // Una espera sin unidad se guardaba y después el motor no sabía cuánto
    // esperar.
    const { plan, problemas } = planDesdeIA({
      ...ok,
      pasos: [{ tipo: 'wait', cantidad: 3 }],
    })
    expect(plan).toBeNull()
    expect(problemas.length).toBeGreaterThan(0)
  })

  it('descarta un tipo de paso que no existe', () => {
    const { plan, problemas } = planDesdeIA({
      ...ok,
      pasos: [{ tipo: 'mandar_paloma', texto: 'hola' }],
    })
    expect(plan).toBeNull()
    expect(problemas.some((p) => p.path === 'pasos')).toBe(true)
  })

  it('no deja crear una automatización sin pasos', () => {
    const { plan } = planDesdeIA({ ...ok, pasos: [] })
    expect(plan).toBeNull()
  })

  it('arma condiciones con sus dos ramas', () => {
    const { plan, problemas } = planDesdeIA({
      nombre: 'Rescate',
      disparador: 'shopify_abandoned_checkout',
      pasos: [
        { tipo: 'wait', cantidad: 15, unidad: 'minutes' },
        {
          tipo: 'condition',
          sujeto: 'order_paid',
          si: [{ tipo: 'add_tag', etiqueta: 'compro' }],
          no: [{ tipo: 'send_message', texto: 'Te quedó algo en el carrito.' }],
        },
      ],
    })
    expect(problemas).toEqual([])
    const cond = plan?.pasos[1]
    expect(cond?.step_type).toBe('condition')
    expect(cond?.branches?.yes?.[0].step_type).toBe('add_tag')
    expect(cond?.branches?.no?.[0].step_type).toBe('send_message')
  })

  it('una condición sin sujeto no pasa', () => {
    const { plan } = planDesdeIA({
      ...ok,
      pasos: [{ tipo: 'condition', si: [], no: [] }],
    })
    expect(plan).toBeNull()
  })

  it('exige nombre', () => {
    const { plan, problemas } = planDesdeIA({ ...ok, nombre: '   ' })
    expect(plan).toBeNull()
    expect(problemas.some((p) => p.path === 'nombre')).toBe(true)
  })
})
