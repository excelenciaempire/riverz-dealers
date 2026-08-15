import { describe, it, expect } from 'vitest'
import { relativeStamp } from './runner'

/**
 * El agente veía la conversación sin ninguna hora: no distinguía un mensaje
 * de recién de uno del mes pasado y contestaba "como te decía" sobre algo
 * viejo. Estas son las palabras que ahora encabezan cada turno.
 */
describe('relativeStamp', () => {
  const ahora = new Date('2026-08-15T12:00:00.000Z').getTime()
  const hace = (ms: number) => new Date(ahora - ms).toISOString()

  it('lo de hace un momento', () => {
    expect(relativeStamp(hace(20_000), ahora)).toBe('recién')
  })

  it('minutos y horas', () => {
    expect(relativeStamp(hace(10 * 60_000), ahora)).toBe('hace 10 min')
    expect(relativeStamp(hace(3 * 3_600_000), ahora)).toBe('hace 3 h')
  })

  it('ayer, en vez de "hace 24 h"', () => {
    expect(relativeStamp(hace(25 * 3_600_000), ahora)).toBe('ayer')
  })

  it('días y meses', () => {
    expect(relativeStamp(hace(5 * 86_400_000), ahora)).toBe('hace 5 días')
    expect(relativeStamp(hace(60 * 86_400_000), ahora)).toBe('hace 2 meses')
  })

  it('una fecha ilegible no inventa nada', () => {
    expect(relativeStamp('cualquier cosa', ahora)).toBe('')
  })
})
