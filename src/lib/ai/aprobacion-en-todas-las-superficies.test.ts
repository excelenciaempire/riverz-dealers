import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_TOOLBOX, herramientasQueRequierenAprobacion } from './toolbox'

/**
 * "Con aprobación" tiene que frenar en TODAS las superficies, no sólo en el
 * chat.
 *
 * `runWithTools` frena una herramienta y pide permiso mirando
 * `localOrders.requiereAprobacion`. El compositor de comentarios llamaba sin
 * `localOrders`, así que el freno no podía dispararse nunca: un comercio con
 * `crear_pedido` en "aprobación" tenía pedidos REALES creados desde un
 * comentario público, sin que nadie los aprobara. Y el comentario es la
 * superficie donde cualquiera puede escribir.
 *
 * El modo de falla es siempre el mismo: se agrega una superficie que compone
 * con herramientas y se olvida el contexto que trae la puerta. Por eso el test
 * mira el código y no el comportamiento.
 */

const RAIZ = join(process.cwd(), 'src', 'lib', 'ai')

/** Las que ejecutan herramientas contra la cuenta del comercio. */
const CON_HERRAMIENTAS = [
  { archivo: 'runner.ts', que: 'el chat' },
  { archivo: 'super-agent.ts', que: 'los comentarios' },
]

describe('la puerta de "con aprobación"', () => {
  for (const { archivo, que } of CON_HERRAMIENTAS) {
    it(`${que} (${archivo}) le pasa requiereAprobacion a runWithTools`, () => {
      const src = readFileSync(join(RAIZ, archivo), 'utf8')
      expect(src, `${archivo} no arma la lista de aprobación`).toContain(
        'herramientasQueRequierenAprobacion',
      )
      expect(src, `${archivo} no arma localOrders`).toContain('localOrders')
    })
  }

  it('la lista sale del toolbox y no se reescribe en cada superficie', () => {
    // El bug original: la lista estaba en línea dentro del runner, así que la
    // superficie nueva no la tenía. Si vuelve a aparecer escrita a mano, este
    // test la encuentra.
    for (const { archivo } of CON_HERRAMIENTAS) {
      const src = readFileSync(join(RAIZ, archivo), 'utf8')
      expect(
        src.includes("=== 'aprobacion'"),
        `${archivo} vuelve a filtrar el modo a mano en vez de usar el toolbox`,
      ).toBe(false)
    }
  })

  it('deja afuera las que ya piden confirmación por su cuenta', () => {
    const agent = {
      tools: Object.fromEntries(AGENT_TOOLBOX.map((t) => [t.key, 'aprobacion'])),
    }
    const lista = herramientasQueRequierenAprobacion(agent as never)
    for (const spec of AGENT_TOOLBOX) {
      if (spec.proponeSolo) {
        expect(lista, `${spec.key} pediría dos confirmaciones por lo mismo`).not.toContain(
          spec.key,
        )
      } else if (spec.modes.includes('aprobacion')) {
        expect(lista, `${spec.key} quedaría sin puerta`).toContain(spec.key)
      }
    }
  })

  it('un agente sin nada en aprobación no frena nada', () => {
    const agent = {
      tools: Object.fromEntries(AGENT_TOOLBOX.map((t) => [t.key, 'auto'])),
    }
    expect(herramientasQueRequierenAprobacion(agent as never)).toEqual([])
  })
})
