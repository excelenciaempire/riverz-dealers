import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ventanaDeBusqueda } from './poll'

/**
 * Una caída de más de un día no puede perder correo.
 *
 * La ventana era `newer_than:1d` fija, y ese "1d" era una apuesta a que el
 * recorrido no falla nunca. Con el servicio caído, el buzón en error o la
 * conexión sin token durante más de 24 h, ese correo quedaba afuera PARA
 * SIEMPRE: la siguiente corrida también miraba un solo día.
 */

const hace = (ms: number) => new Date(Date.now() - ms).toISOString()
const HORA = 3_600_000
const DIA = 24 * HORA

describe('la ventana de búsqueda de Gmail', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())
  it('un buzón recién conectado ve una semana', () => {
    // Para que el comercio vea historial de verdad y no una bandeja vacía.
    expect(ventanaDeBusqueda(null)).toBe('newer_than:7d')
    expect(ventanaDeBusqueda(undefined)).toBe('newer_than:7d')
  })

  it('con el recorrido al día, pide un día', () => {
    expect(ventanaDeBusqueda(hace(3 * HORA))).toBe('newer_than:1d')
  })

  it('tras una caída larga, ensancha hasta cubrirla', () => {
    // 40 horas caído ⇒ 2 días de hueco + 1 de gracia por los relojes.
    expect(ventanaDeBusqueda(hace(40 * HORA))).toBe('newer_than:3d')
    expect(ventanaDeBusqueda(hace(7 * DIA))).toBe('newer_than:8d')
  })

  it('no se va más de treinta días', () => {
    // Más atrás Gmail se pone lento y ese correo ya lo atendió una persona.
    expect(ventanaDeBusqueda(hace(200 * DIA))).toBe('newer_than:30d')
  })

  it('una fecha ilegible cae al comportamiento de siempre', () => {
    expect(ventanaDeBusqueda('no es una fecha')).toBe('newer_than:1d')
  })
})
