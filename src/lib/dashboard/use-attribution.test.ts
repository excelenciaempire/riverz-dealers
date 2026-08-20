import { describe, expect, it } from 'vitest'

import { estabilizar } from './use-attribution'

/**
 * Lo que hace que la atribución se pida una vez y no en cada mensaje que entra.
 *
 * El panel es en vivo y cada refresco recalcula el rango con la hora actual. Si
 * el fin del rango cambia al milisegundo, el efecto que trae la atribución se
 * vuelve a disparar cada vez — contra un endpoint que hace una consulta por
 * pedido del período. Estas pruebas son sobre esa estabilidad, no sobre el
 * formato.
 */
describe('estabilizar el rango', () => {
  it('dos momentos del mismo bloque de cinco minutos dan lo mismo', () => {
    const a = estabilizar('2026-08-19T14:32:10.123Z', true)
    const b = estabilizar('2026-08-19T14:34:59.999Z', true)
    expect(a).toBe(b)
  })

  it('el fin nunca se queda corto: redondea hacia adelante', () => {
    // Perder los pedidos de los últimos minutos sería peor que contarlos tarde.
    expect(estabilizar('2026-08-19T14:31:00.000Z', true)).toBe('2026-08-19T14:35:00.000Z')
  })

  it('un fin ya en el límite no se corre cinco minutos más', () => {
    expect(estabilizar('2026-08-19T14:35:00.000Z', true)).toBe('2026-08-19T14:35:00.000Z')
  })

  it('la medianoche del inicio no se mueve', () => {
    // Los presets arrancan en un límite de día; correrlo cambiaría el período.
    expect(estabilizar('2026-08-19T00:00:00.000Z', false)).toBe('2026-08-19T00:00:00.000Z')
  })

  it('un bloque siguiente sí da distinto', () => {
    const a = estabilizar('2026-08-19T14:34:00.000Z', true)
    const b = estabilizar('2026-08-19T14:36:00.000Z', true)
    expect(a).not.toBe(b)
  })

  it('una fecha ilegible se devuelve tal cual, sin romper el pedido', () => {
    expect(estabilizar('no es una fecha', true)).toBe('no es una fecha')
  })
})
