import { describe, it, expect } from 'vitest'

import { ALL_CAPABILITIES } from '@/lib/capabilities/registry'
import { OPERATOR_CAPABILITIES, operatorCanUse } from './capabilities'

/**
 * Qué puede tocar el Operator.
 *
 * La lista es corta a propósito y esta prueba es la que impide que crezca por
 * descuido: sumar una capacidad al catálogo NO tiene que dársela al Operator,
 * porque el Operator opera con la clave de la plataforma y sobre la cuenta de
 * un comercio real.
 */
describe('capacidades del Operator', () => {
  it('no puede escribirle a un cliente', () => {
    // Esa conversación la abre una persona desde la bandeja. Entra cuando
    // exista el permiso por acción que lo gobierne.
    expect(operatorCanUse('mensajes.enviar')).toBe(false)
    expect(OPERATOR_CAPABILITIES.some((c) => c.key === 'mensajes.enviar')).toBe(false)
  })

  it('todas las habilitadas existen en el catálogo', () => {
    // Una clave mal escrita dejaría al Operator sin esa herramienta en
    // silencio, y el síntoma sería "no sabe hacer eso".
    for (const c of OPERATOR_CAPABILITIES) {
      expect(ALL_CAPABILITIES.some((x) => x.key === c.key), c.key).toBe(true)
    }
    expect(OPERATOR_CAPABILITIES.length).toBeGreaterThan(10)
  })

  it('lo que cambia algo trae preview o es reversible', () => {
    // Una irreversible sin vista previa se aprobaría a ciegas.
    for (const c of OPERATOR_CAPABILITIES.filter((x) => x.risk === 'irreversible')) {
      expect(typeof c.preview, c.key).toBe('function')
    }
  })

  it('la puerta se cierra por clave y no sólo por la lista de tools', () => {
    // El nombre de la herramienta lo elige el modelo: el loop vuelve a
    // preguntar antes de ejecutar.
    expect(operatorCanUse('no.existe')).toBe(false)
    expect(operatorCanUse('metricas.resumen')).toBe(true)
  })
})
