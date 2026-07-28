import { describe, it, expect } from 'vitest'
import { fmt, niceScale } from './response-time-chart'

/**
 * El eje se leía "0 / 4.2h / 8.3h": números redondos en minutos que al
 * mostrarse en horas dejaban de serlo. Estas pruebas fijan que el tope y
 * su marca intermedia queden siempre en valores que uno escribiría a mano.
 */

describe('niceScale', () => {
  it('sube por escalones reconocibles', () => {
    expect(niceScale(3)).toBe(5)
    expect(niceScale(7)).toBe(10)
    expect(niceScale(25)).toBe(30)
    expect(niceScale(45)).toBe(60)
    expect(niceScale(100)).toBe(120)
    expect(niceScale(250)).toBe(360)
  })

  it('el tope y su mitad se escriben en unidades limpias', () => {
    // Es la regresión concreta: un pico de ~4h daba un tope de 500 minutos,
    // que en pantalla era "8.3h".
    const max = niceScale(250)
    expect(fmt(max)).toBe('6h')
    expect(fmt(max / 2)).toBe('3h')
  })

  it('todos los escalones parten en dos sin decimales feos', () => {
    for (const v of [4, 9, 19, 29, 59, 89, 119, 179, 239, 359, 479, 719, 1439]) {
      const max = niceScale(v)
      expect(max).toBeGreaterThanOrEqual(v)
      // La marca intermedia es la que más delata un tope mal elegido.
      expect(fmt(max / 2)).not.toMatch(/\.\d/)
    }
  })

  it('pasa a días enteros más allá de las 24 horas', () => {
    expect(niceScale(1441)).toBe(2880)
    expect(niceScale(3000)).toBe(4320)
  })
})

describe('fmt', () => {
  it('escribe las horas exactas sin decimal', () => {
    expect(fmt(120)).toBe('2h')
    expect(fmt(360)).toBe('6h')
  })

  it('conserva el decimal cuando hace falta', () => {
    expect(fmt(90)).toBe('1.5h')
  })

  it('usa minutos y segundos por debajo de la hora', () => {
    expect(fmt(45)).toBe('45m')
    expect(fmt(0.5)).toBe('30s')
  })

  it('distingue el cero del dato ausente', () => {
    expect(fmt(0)).toBe('0')
    expect(fmt(null)).toBe('—')
  })
})
