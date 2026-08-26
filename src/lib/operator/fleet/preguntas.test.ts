import { describe, it, expect } from 'vitest'
import { CUANDO_PREGUNTAR, PREGUNTAS_POR_DOMINIO, preguntasDe } from './preguntas'
import { promptSubagente } from './prompts'
import { SUBAGENT_IDS } from './types'

/**
 * El catálogo de preguntas no puede quedarse atrás del equipo.
 *
 * Un especialista nuevo sin su lista hereda «no preguntes lo que puedes
 * averiguar» sin la excepción, que es justo la mitad que hace daño: ante un
 * dato que no existe en la cuenta, inventa o abandona la pieza.
 */
describe('lo que sólo sabe la persona', () => {
  it('cada especialista tiene su lista', () => {
    for (const id of SUBAGENT_IDS) {
      expect(PREGUNTAS_POR_DOMINIO[id], id).toBeDefined()
      expect(PREGUNTAS_POR_DOMINIO[id].length, id).toBeGreaterThan(0)
    }
  })

  it('y le llega dentro de su prompt', () => {
    const p = promptSubagente('plantillas')
    expect(p).toContain('CUÁNDO SÍ HAY QUE PREGUNTAR')
    expect(p).toContain('condición exacta de una oferta')
  })

  it('la regla que evita que una pregunta reemplace al trabajo va primero', () => {
    // El orden importa: si «entrega primero» no es la primera de la lista, el
    // modelo contesta con la pregunta sola y deja el encargo sin hacer. Es lo
    // que pasó con el mensaje de mayoristas.
    const entrega = CUANDO_PREGUNTAR.indexOf('Primero entrega')
    const unaSola = CUANDO_PREGUNTAR.indexOf('Una sola pregunta')
    expect(entrega).toBeGreaterThan(-1)
    expect(entrega).toBeLessThan(unaSola)
  })

  it('no se le pide permiso a quien ya tiene el botón', () => {
    expect(CUANDO_PREGUNTAR).toContain('Nunca preguntes por permiso')
  })

  it('un dominio sin lista propia igual recibe la regla general', () => {
    // No debería existir hoy —la prueba de arriba lo garantiza— pero la función
    // no puede devolver vacío si mañana existe.
    expect(preguntasDe('integraciones')).toContain('CUÁNDO SÍ HAY QUE PREGUNTAR')
  })
})
