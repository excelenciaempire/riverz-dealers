import { describe, expect, it } from 'vitest'
import { costoAmpliacionCentavos } from './upgrade-policy'

describe('ampliación por capacidad del ciclo', () => {
  it('cobra la diferencia completa sin importar el día del ciclo', () => {
    expect(costoAmpliacionCentavos(99900, 199900)).toBe(100000)
    expect(costoAmpliacionCentavos(39900, 99900)).toBe(60000)
  })

  it('conserva el descuento ya pagado en el plan inicial', () => {
    expect(64900 + costoAmpliacionCentavos(99900, 199900)).toBe(164900)
    expect(129900).toBeLessThan(164900)
  })

  it('no admite un cambio a igual o menor precio', () => {
    expect(() => costoAmpliacionCentavos(99900, 99900)).toThrow()
    expect(() => costoAmpliacionCentavos(99900, 39900)).toThrow()
  })
})
