import { describe, it, expect } from 'vitest'
import {
  extractVariables,
  validateVariableSequence,
  normalizeTemplateName,
  buildTemplateComponents,
} from './template-components'

describe('extractVariables', () => {
  it('finds and sorts distinct variable indices', () => {
    expect(extractVariables('Hola {{1}}, tu pedido {{2}} y {{1}} otra vez')).toEqual([
      1, 2,
    ])
  })
  it('returns empty for no variables', () => {
    expect(extractVariables('Sin variables')).toEqual([])
  })
})

describe('validateVariableSequence', () => {
  it('accepts a contiguous run from 1', () => {
    expect(validateVariableSequence('{{1}} {{2}} {{3}}')).toBeNull()
  })
  it('rejects a gap', () => {
    expect(validateVariableSequence('{{1}} {{3}}')).toMatch(/correlativas/)
  })
  it('rejects not starting at 1', () => {
    expect(validateVariableSequence('{{2}}')).toMatch(/correlativas/)
  })
})

describe('normalizeTemplateName', () => {
  it('lowercases and snake_cases', () => {
    expect(normalizeTemplateName('Mi Plantilla 2!')).toBe('mi_plantilla_2')
  })
  it('collapses repeats and trims underscores', () => {
    expect(normalizeTemplateName('  __Hola   Mundo__  ')).toBe('hola_mundo')
  })
})

describe('buildTemplateComponents', () => {
  it('builds a body-only component', () => {
    const { components, error } = buildTemplateComponents({
      category: 'MARKETING',
      headerType: 'none',
      bodyText: 'Hola, gracias por escribirnos.',
    })
    expect(error).toBeNull()
    expect(components).toHaveLength(1)
    expect(components[0]).toMatchObject({ type: 'BODY' })
  })

  it('requires a sample per body variable', () => {
    const { error } = buildTemplateComponents({
      category: 'MARKETING',
      headerType: 'none',
      bodyText: 'Hola {{1}}',
    })
    expect(error).toMatch(/ejemplo/)
  })

  it('emits body example when samples are provided', () => {
    const { components, error } = buildTemplateComponents({
      category: 'MARKETING',
      headerType: 'none',
      bodyText: 'Hola {{1}}, tu cita es {{2}}',
      bodySamples: ['Ana', 'el lunes'],
    })
    expect(error).toBeNull()
    const body = components.find((c) => c.type === 'BODY')
    expect(body?.example).toEqual({ body_text: [['Ana', 'el lunes']] })
  })

  it('includes header, footer and buttons in order', () => {
    const { components, error } = buildTemplateComponents({
      category: 'UTILITY',
      headerType: 'text',
      headerText: 'Recordatorio',
      bodyText: 'Tu cita es mañana.',
      footerText: 'Equipo Vitalú',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Confirmar' },
        { type: 'URL', text: 'Ver', url: 'https://example.com' },
      ],
    })
    expect(error).toBeNull()
    expect(components.map((c) => c.type)).toEqual([
      'HEADER',
      'BODY',
      'FOOTER',
      'BUTTONS',
    ])
  })

  it('rejects a media header without a sample handle', () => {
    const { error } = buildTemplateComponents({
      category: 'MARKETING',
      headerType: 'image',
      bodyText: 'Mira esto',
    })
    expect(error).toMatch(/multimedia/)
  })

  it('rejects a URL button without a url', () => {
    const { error } = buildTemplateComponents({
      category: 'MARKETING',
      headerType: 'none',
      bodyText: 'Hola',
      buttons: [{ type: 'URL', text: 'Ver' }],
    })
    expect(error).toMatch(/URL/)
  })
})
