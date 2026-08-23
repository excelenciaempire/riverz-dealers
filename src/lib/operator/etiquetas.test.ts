import { describe, expect, it } from 'vitest'

import { ALL_CAPABILITIES } from '@/lib/capabilities/registry'
import { ROSTER } from '@/lib/operator/fleet/roster'
import { nombreDeSubagente } from '@/lib/operator/fleet/types'
import { MESSAGES } from '@/lib/i18n/messages/registry'
import { etiquetaDe } from './etiquetas'

/**
 * Cómo se nombra un paso: por lo que TOCÓ, sin verbo.
 *
 * Antes esto devolvía la primera cláusula de la descripción de la capacidad
 * —un texto escrito para el modelo— y la pantalla tenía además su propio
 * diccionario de 31 etiquetas a mano. En la misma lista, seguidas, convivían
 * tres personas gramaticales: «Revisando las plantillas», «Leo la plantilla» y
 * «Escribe una plantilla de WhatsApp». La tercera era ésta, y alcanzaba a 41
 * de las 72 capacidades.
 */
describe('el nombre de un paso', () => {
  it('nunca es la clave, en ninguna capacidad y en los dos idiomas', () => {
    for (const c of ALL_CAPABILITIES) {
      for (const locale of ['es', 'en']) {
        const e = etiquetaDe(c, locale)
        expect(e, c.key).not.toBe(c.key)
        expect(e.length, c.key).toBeGreaterThan(3)
        expect(e.length, c.key).toBeLessThanOrEqual(60)
        expect(e, c.key).not.toMatch(/^[a-z_]+\.[a-z_]+$/)
      }
    }
  })

  it('nunca queda cortado a media palabra ni con un paréntesis abierto', () => {
    // Salían cuatro truncados —«…listas par…», «…en camp…»— y uno abría un
    // paréntesis que nunca cerraba, porque el corte caía adentro.
    for (const c of ALL_CAPABILITIES) {
      const e = etiquetaDe(c, 'es')
      expect(e, c.key).not.toContain('…')
      expect((e.match(/\(/g) ?? []).length, c.key).toBe((e.match(/\)/g) ?? []).length)
    }
  })

  it('todas las capacidades del mismo dominio se llaman igual', () => {
    // Es la regla entera: el paso dice qué tocó, y el icono dice cómo salió.
    const porDominio = new Map<string, Set<string>>()
    for (const c of ALL_CAPABILITIES) {
      const dom = c.key.split('.')[0]
      if (!porDominio.has(dom)) porDominio.set(dom, new Set())
      porDominio.get(dom)!.add(etiquetaDe(c, 'es'))
    }
    for (const [dom, nombres] of porDominio) {
      expect([...nombres], dom).toHaveLength(1)
    }
  })

  it('en inglés dice otra cosa', () => {
    const c = ALL_CAPABILITIES[0]
    expect(etiquetaDe(c, 'en')).not.toBe(etiquetaDe(c, 'es'))
  })
})

describe('el nombre de un especialista', () => {
  it('lo calcula igual que el roster', () => {
    // La pantalla lo calcula sin importar el roster: por catorce nombres se
    // arrastraban las 72 capacidades al bundle del navegador. Esto es lo que
    // impide que las dos formas se separen.
    for (const s of ROSTER) {
      expect(nombreDeSubagente(s.id), s.id).toBe(s.nombreKey)
    }
  })

  it('está en el catálogo, en los dos idiomas', () => {
    for (const s of ROSTER) {
      const entrada = MESSAGES[s.nombreKey]
      expect(entrada, s.nombreKey).toBeTruthy()
      expect(entrada.es, s.nombreKey).toBeTruthy()
      expect(entrada.en, s.nombreKey).toBeTruthy()
    }
  })
})
