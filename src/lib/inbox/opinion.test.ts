import { describe, it, expect } from 'vitest'
import { leerCalificacion } from './opinion'

/**
 * Lo que se está protegiendo acá no es el parseo: es que una consulta NO se lea
 * como una calificación. El costo de los dos errores no es el mismo — perder
 * una nota es perder un dato, y comerse una consulta es dejar a alguien sin
 * respuesta creyendo que ya lo atendieron.
 */
describe('leerCalificacion', () => {
  it('lee el número, el sí/no y el pulgar', () => {
    expect(leerCalificacion('1')).toBe(1)
    expect(leerCalificacion(' Sí ')).toBe(1)
    expect(leerCalificacion('si')).toBe(1)
    expect(leerCalificacion('yes')).toBe(1)
    expect(leerCalificacion('👍')).toBe(1)
    expect(leerCalificacion('2')).toBe(-1)
    expect(leerCalificacion('No.')).toBe(-1)
    expect(leerCalificacion('👎')).toBe(-1)
  })

  it('no se come una consulta que empieza igual', () => {
    expect(leerCalificacion('no me llegó el pedido')).toBeNull()
    expect(leerCalificacion('si, pero quiero cambiarlo')).toBeNull()
    expect(leerCalificacion('1 unidad más por favor')).toBeNull()
    expect(leerCalificacion('')).toBeNull()
    expect(leerCalificacion('   ')).toBeNull()
  })

  it('ignora números que no son la escala', () => {
    expect(leerCalificacion('3')).toBeNull()
    expect(leerCalificacion('10')).toBeNull()
  })
})
