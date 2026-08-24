import { describe, it, expect } from 'vitest'
import { SUBAGENT_IDS, type SubagentId } from './types'
import { capacidadesDe } from './roster'
import { capabilitiesAsAnthropicTools } from '@/lib/capabilities/registry'

/**
 * Las herramientas de cada especialista, como las acepta Anthropic.
 *
 * Un solo esquema mal formado tumba al especialista ENTERO: la API contesta 400
 * antes de mirar el encargo, así que no falla una capacidad — no arranca nadie.
 * Y como el subagente muere antes de la primera llamada, no queda ni un token
 * gastado ni un paso en rojo: el de al lado recibe «no responde por un error
 * técnico» y el plan se cierra diciendo «2 pasos listos».
 *
 * Pasó en producción el 2026-08-24 con `productos`.
 */
describe('las herramientas que recibe cada especialista', () => {
  const ids = [...SUBAGENT_IDS] as SubagentId[]

  it.each(ids)('%s tiene al menos una', (id) => {
    expect(capacidadesDe(id).length).toBeGreaterThan(0)
  })

  it.each(ids)('%s las declara como Anthropic las exige', (id) => {
    const tools = capabilitiesAsAnthropicTools(capacidadesDe(id))
    for (const t of tools) {
      // Nombre: hasta 64 caracteres de [a-zA-Z0-9_-]. Los puntos de la clave ya
      // se cambian por «__», pero un dominio largo con una acción larga se pasa.
      expect(t.name, `${id} → ${t.name}`).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
      expect(t.description.trim().length, `${id} → ${t.name}`).toBeGreaterThan(0)
      expect(t.input_schema.type, `${id} → ${t.name}`).toBe('object')
      expect(t.input_schema.properties, `${id} → ${t.name}`).toBeTruthy()

      // `required` sólo puede nombrar propiedades que existen: Anthropic
      // rechaza el esquema entero cuando pide una que no está declarada.
      for (const req of t.input_schema.required ?? []) {
        expect(
          Object.keys(t.input_schema.properties ?? {}),
          `${id} → ${t.name} pide «${req}» y no lo declara`,
        ).toContain(req)
      }

      // Cada propiedad necesita su tipo: un `{}` pelado no es un esquema.
      for (const [prop, def] of Object.entries(t.input_schema.properties ?? {})) {
        expect((def as { type?: string }).type, `${id} → ${t.name}.${prop}`).toBeTruthy()
      }
    }
  })

  it('ningún nombre de herramienta se repite dentro de un especialista', () => {
    for (const id of ids) {
      const nombres = capacidadesAsNombres(id)
      expect(new Set(nombres).size, `${id}`).toBe(nombres.length)
    }
  })
})

function capacidadesAsNombres(id: SubagentId): string[] {
  return capabilitiesAsAnthropicTools(capacidadesDe(id)).map((t) => t.name)
}
