import { describe, it, expect } from 'vitest'

import {
  ALL_CAPABILITIES,
  capabilitiesAsAnthropicTools,
  capabilityKeyFromToolName,
  findCapability,
  getCapability,
  withWorkspaceArg,
} from './registry'

/**
 * Invariantes del catálogo. Son las que hacen que sumar una capacidad nueva no
 * pueda abrir un agujero: si alguien agrega una irreversible sin `preview`, el
 * servidor la ejecutaría sin que nadie vea qué iba a hacer.
 */

describe('catálogo de capacidades', () => {
  it('las claves son únicas', () => {
    const keys = ALL_CAPABILITIES.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('toda clave tiene dominio (dominio.accion)', () => {
    for (const c of ALL_CAPABILITIES) {
      expect(c.key, c.key).toMatch(/^[a-z_]+\.[a-z_]+$/)
    }
  })

  it('toda irreversible trae preview', () => {
    // Sin preview no hay nada que mostrarle a la persona que confirma, y una
    // confirmación a ciegas no es una confirmación.
    for (const c of ALL_CAPABILITIES.filter((x) => x.risk === 'irreversible')) {
      expect(typeof c.preview, c.key).toBe('function')
    }
  })

  it('ninguna pide workspace_id como argumento', () => {
    // La cuenta va en el contexto: si fuera un argumento, bastaría con escribir
    // otro uuid para leer datos ajenos.
    for (const c of ALL_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
      expect(c.schema.required ?? [], c.key).not.toContain('workspace_id')
    }
  })

  it('toda capacidad se describe en los dos idiomas', () => {
    for (const c of ALL_CAPABILITIES) {
      expect(c.description.length, c.key).toBeGreaterThan(20)
      expect(c.descriptionEn.length, c.key).toBeGreaterThan(20)
    }
  })

  it('todo lo requerido está declarado en properties', () => {
    for (const c of ALL_CAPABILITIES) {
      for (const req of c.schema.required ?? []) {
        expect(Object.keys(c.schema.properties), `${c.key}.${req}`).toContain(req)
      }
    }
  })
})

describe('búsqueda', () => {
  it('encuentra por clave', () => {
    expect(findCapability('metricas.resumen')?.risk).toBe('lectura')
  })

  it('devuelve undefined si no existe', () => {
    expect(findCapability('no.existe')).toBeUndefined()
  })

  it('getCapability corta con un mensaje útil', () => {
    expect(() => getCapability('no.existe')).toThrow(/no existe la capacidad/)
  })
})

describe('withWorkspaceArg', () => {
  it('agrega la cuenta y la deja obligatoria', () => {
    const s = withWorkspaceArg({
      type: 'object',
      properties: { telefono: { type: 'string' } },
      required: ['telefono'],
    })
    expect(s.properties).toHaveProperty('workspace_id')
    expect(s.required).toEqual(['workspace_id', 'telefono'])
  })

  it('funciona con un schema sin requeridos', () => {
    const s = withWorkspaceArg({ type: 'object', properties: {} })
    expect(s.required).toEqual(['workspace_id'])
  })
})

describe('puente con Anthropic', () => {
  it('los nombres no llevan puntos y se pueden revertir', () => {
    for (const t of capabilitiesAsAnthropicTools()) {
      expect(t.name).not.toContain('.')
      expect(findCapability(capabilityKeyFromToolName(t.name))).toBeDefined()
    }
  })

  it('no le ofrece workspace_id al modelo', () => {
    for (const t of capabilitiesAsAnthropicTools()) {
      expect(Object.keys(t.input_schema.properties), t.name).not.toContain('workspace_id')
    }
  })
})
