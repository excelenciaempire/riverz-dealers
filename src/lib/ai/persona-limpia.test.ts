import { describe, it, expect } from 'vitest'
import { limpiarPersona } from './persona-limpia'

/**
 * Un agente que ya tiene "[object Object]" guardado en su persona lo manda en
 * CADA respuesta. El bug que lo escribió está arreglado desde el editor, pero
 * eso no desanda lo guardado: el asesor de Serum Pilar seguía diciéndole al
 * modelo "Maneja con tacto estas objeciones comunes: [object Object]" —una
 * instrucción sin contenido, ocupando lugar en el prompt— tres semanas después.
 */
describe('limpiarPersona', () => {
  it('saca la oración que quedó sin contenido', () => {
    const roto =
      'Eres un asesor de Serum Pilar. Maneja con tacto estas objeciones comunes: [object Object]; [object Object]. Una pregunta por turno.'
    const limpio = limpiarPersona(roto)
    expect(limpio).not.toContain('[object Object]')
    expect(limpio).not.toContain('objeciones comunes')
    // Lo que sí decía algo se queda.
    expect(limpio).toContain('Eres un asesor de Serum Pilar.')
    expect(limpio).toContain('Una pregunta por turno.')
  })

  it('no toca una persona sana', () => {
    const sana = 'Eres un asesor.\n\nHablas corto y claro.'
    expect(limpiarPersona(sana)).toBe(sana)
  })

  it('recorta los espacios de una persona sana', () => {
    expect(limpiarPersona('  Eres un asesor.  ')).toBe('Eres un asesor.')
  })

  it('si la línea entera era la basura, se va la línea', () => {
    const roto = 'Eres un asesor.\nObjeciones: [object Object].\nHablas corto.'
    const limpio = limpiarPersona(roto)
    expect(limpio).not.toContain('[object Object]')
    expect(limpio).toContain('Eres un asesor.')
    expect(limpio).toContain('Hablas corto.')
  })
})
