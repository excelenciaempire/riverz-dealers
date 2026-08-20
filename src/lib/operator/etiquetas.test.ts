import { describe, expect, it } from 'vitest'

import { ALL_CAPABILITIES } from '@/lib/capabilities/registry'
import { etiquetaDe } from './etiquetas'

/**
 * Que la clave nunca llegue a la pantalla.
 *
 * Pasó de verdad: en medio de una conversación en español apareció
 * `integraciones.estado` entre dos pasos bien escritos, porque el servidor
 * mandaba la clave como etiqueta y la pantalla sólo tiene diccionario para
 * veintipico de las ochenta y pico de capacidades.
 */
describe('el nombre de un paso', () => {
  it('nunca es la clave, en ninguna capacidad y en los dos idiomas', () => {
    for (const c of ALL_CAPABILITIES) {
      for (const locale of ['es', 'en']) {
        const e = etiquetaDe(c, locale)
        expect(e, c.key).not.toBe(c.key)
        expect(e.length, c.key).toBeGreaterThan(3)
        expect(e.length, c.key).toBeLessThanOrEqual(60)
        // Una clave se reconoce por el punto entre dos palabras sin espacio.
        expect(e, c.key).not.toMatch(/^[a-z_]+\.[a-z_]+$/)
      }
    }
  })

  it('en inglés usa el texto en inglés', () => {
    const c = ALL_CAPABILITIES.find((x) => x.descriptionEn && x.descriptionEn !== x.description)!
    expect(etiquetaDe(c, 'en')).not.toBe(etiquetaDe(c, 'es'))
  })
})
