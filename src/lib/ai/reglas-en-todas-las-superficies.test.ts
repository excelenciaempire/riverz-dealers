import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Las Reglas del negocio valen en TODAS las superficies que le hablan al
 * cliente, no sólo en el chat.
 *
 * Nacieron cargándose únicamente en `ai/runner.ts`, así que gobernaban el chat
 * y no los comentarios ni los borradores. El comentario es la superficie
 * PÚBLICA: una promesa equivocada ahí la lee cualquiera que pase por el
 * anuncio. El 2026-08-29 la IA contestó "pago contra entrega" debajo de una
 * publicación, a una clienta que lo dio por hecho, cuando el comercio no lo
 * ofrece — y la regla que lo habría frenado no llegaba a ese camino.
 *
 * Este test no prueba qué dice una regla: prueba que cada superficie las CARGA.
 * Si mañana aparece otra que compone un mensaje para un cliente, tiene que
 * entrar a esta lista o explicar por qué no.
 */

const RAIZ = join(process.cwd(), 'src', 'lib', 'ai')

/** Los archivos que componen algo que va a leer un cliente. */
const SUPERFICIES = [
  { archivo: 'runner.ts', que: 'el chat' },
  { archivo: 'super-agent.ts', que: 'los comentarios' },
  { archivo: 'borrador.ts', que: 'el borrador que manda una persona' },
  { archivo: 'followup.ts', que: 'el seguimiento' },
]

describe('las reglas del comercio llegan a todas las superficies', () => {
  for (const { archivo, que } of SUPERFICIES) {
    it(`${que} (${archivo}) carga agent_guidance`, () => {
      const src = readFileSync(join(RAIZ, archivo), 'utf8')
      expect(src, `${archivo} no importa cargarReglas`).toContain('cargarReglas')
      expect(src, `${archivo} no renderiza las reglas`).toContain('reglasATexto')
    })
  }

  it('ninguna las pasa en null', () => {
    // El modo de falla real: se agrega un parámetro nuevo a buildSystemPrompt y
    // se rellena el hueco de `reglas` con null para poder pasar el siguiente.
    for (const { archivo } of SUPERFICIES) {
      const src = readFileSync(join(RAIZ, archivo), 'utf8')
      const sospechoso = /businessCurrency,\s*\n\s*null,/m.test(src)
      expect(sospechoso, `${archivo} pasa null donde van las reglas`).toBe(false)
    }
  })
})
