import { describe, it, expect } from 'vitest'
import { codigoDePais } from './create-order'

/**
 * Tiendanube contesta `422 No country with code Colombia` cuando le llega el
 * nombre en vez del código, y el pedido no se crea. El agente escribe el
 * nombre porque es lo que le dijo la clienta, así que la venta se caía por eso.
 * Medido contra la tienda real el 2026-08-23.
 */
describe('codigoDePais', () => {
  it('traduce el nombre al código ISO', () => {
    expect(codigoDePais('Colombia')).toBe('CO')
    expect(codigoDePais('Argentina')).toBe('AR')
    expect(codigoDePais('Brasil')).toBe('BR')
  })

  it('no se cae por tildes, mayúsculas ni espacios de más', () => {
    expect(codigoDePais('méxico')).toBe('MX')
    expect(codigoDePais('  PERÚ  ')).toBe('PE')
    expect(codigoDePais('República  Dominicana')).toBe('DO')
  })

  it('deja pasar lo que ya es un código', () => {
    expect(codigoDePais('CO')).toBe('CO')
    expect(codigoDePais('ar')).toBe('AR')
  })

  it('lo que no reconoce lo pasa tal cual, para que conteste la tienda', () => {
    expect(codigoDePais('Wakanda')).toBe('Wakanda')
  })

  it('vacío es vacío, no una cadena rara', () => {
    expect(codigoDePais(null)).toBe('')
    expect(codigoDePais(undefined)).toBe('')
    expect(codigoDePais('   ')).toBe('')
  })
})
