import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { assistant } from '@/lib/i18n/messages/assistant'

/**
 * Un agente de alcance específico y sin ningún producto asignado.
 *
 * Es una configuración válida y silenciosa: el agente no puede nombrar, cotizar
 * ni buscar nada del catálogo, y a la clienta le contesta que no tiene el
 * producto. Antes `buscar_producto` lo tapaba buscando en TODO el catálogo
 * —ignorando la configuración—, así que el hueco no se notaba; al hacer que
 * respete el alcance, el silencio quedó a la vista. El aviso es lo que evita
 * que alguien lo descubra por una venta perdida.
 */
describe('avisar cuando el agente se queda sin catálogo', () => {
  const editor = readFileSync('src/components/ai/agent-editor.tsx', 'utf8')

  it('el editor muestra el aviso cuando no hay ninguno asignado', () => {
    expect(editor).toContain('scopeSpecificEmpty')
    expect(editor).toContain('selectedProducts.length === 0')
  })

  it('no molesta mientras se está creando el agente', () => {
    // Un asistente nuevo empieza sin productos por definición: avisarle ahí es
    // regañar a alguien por no haber hecho todavía el paso siguiente.
    expect(editor).toMatch(/!isNew && selectedProducts\.length === 0/)
  })

  it('está en los dos idiomas', () => {
    const m = assistant.scopeSpecificEmpty
    expect(m.es.trim().length).toBeGreaterThan(10)
    expect(m.en.trim().length).toBeGreaterThan(10)
    expect(m.es).not.toBe(m.en)
  })
})
