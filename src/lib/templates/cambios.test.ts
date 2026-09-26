import { describe, expect, it } from 'vitest'
import { siguienteVersion } from './cambios'

describe('siguienteVersion', () => {
  it('sube la versión', () => {
    expect(siguienteVersion('revitaly_pago_v3', new Set())).toBe('revitaly_pago_v4')
  })
  it('sin versión arranca en v2', () => {
    expect(siguienteVersion('revitaly_pago', new Set())).toBe('revitaly_pago_v2')
  })
  it('salta las ocupadas', () => {
    expect(siguienteVersion('a_v1', new Set(['a_v2', 'a_v3']))).toBe('a_v4')
  })
})
