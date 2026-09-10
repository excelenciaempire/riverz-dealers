import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VARIANT_INTERPRETATION_RULE } from './runner'

describe('interpretación de variantes publicadas', () => {
  it('trata niña y niño como preferencias, no como variantes inventadas', () => {
    expect(VARIANT_INTERPRETATION_RULE).toContain('expresan una preferencia del cliente')
    expect(VARIANT_INTERPRETATION_RULE).toContain('no son nombres de variante')
    expect(VARIANT_INTERPRETATION_RULE).toContain('todas las variantes reales publicadas y disponibles')
    expect(VARIANT_INTERPRETATION_RULE).toContain('nunca inventes variantes genéricas')
    expect(VARIANT_INTERPRETATION_RULE).not.toContain('puede referirse a “Color Niña”')
  })

  it('mantiene la configuración reproducible de DeUNA alineada con el catálogo real', () => {
    const provision = readFileSync('scripts/provision-deuna-shop.ts', 'utf8')

    for (const model of [
      'Panda Blanco',
      'Cerdita Rosa',
      'Cerdo Blanco',
      'Rana Verde',
      'Oso Rosado',
      'Capibara Café',
    ]) {
      expect(provision).toContain(model)
    }
    expect(provision).toContain('“Para niña” y “para niño” expresan una preferencia')
    expect(provision).not.toContain('“para niña” puede referirse a “Color Niña”')
  })
})
