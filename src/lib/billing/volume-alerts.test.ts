import { describe, expect, it } from 'vitest'
import { umbralDeVolumen } from './volume-alerts'

describe('official plan contact thresholds', () => {
  it('alerts at 80%, 95%, and the full limit', () => {
    expect(umbralDeVolumen(399, 500)).toBeNull()
    expect(umbralDeVolumen(400, 500)).toBe(80)
    expect(umbralDeVolumen(474, 500)).toBe(80)
    expect(umbralDeVolumen(475, 500)).toBe(95)
    expect(umbralDeVolumen(499, 500)).toBe(95)
    expect(umbralDeVolumen(500, 500)).toBe(100)
    expect(umbralDeVolumen(501, 500)).toBe(100)
    expect(umbralDeVolumen(0, 0)).toBeNull()
  })
})
