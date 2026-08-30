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

describe('"aprobar cada mensaje" también frena la respuesta pública', () => {
  const realtime = readFileSync(
    join(process.cwd(), 'src', 'lib', 'instagram-agent', 'realtime.ts'),
    'utf8',
  )

  it('el piso autónomo lee requires_approval y deja la propuesta', () => {
    // Un comercio que aprueba cada mensaje seguía teniendo a la IA publicando
    // sola bajo sus posts y mandándole DM a desconocidos. `requires_approval`
    // no dice POR DÓNDE puede hablar el agente —eso sí es del chat— sino que
    // este comercio no deja que la IA hable sola.
    expect(realtime).toContain('requires_approval')
    expect(realtime).toContain('ai_pending_replies')
    expect(realtime).toContain('comment_espera_aprobacion')
  })

  it('la propuesta se guarda ANTES de decidir el privado', () => {
    // No se abre un DM por algo que todavía nadie aprobó.
    const iAprob = realtime.indexOf('comment_espera_aprobacion')
    const iDm = realtime.indexOf('decideCommentDm({')
    expect(iAprob).toBeGreaterThan(0)
    expect(iDm).toBeGreaterThan(0)
    expect(iAprob, 'la aprobación quedó después de decidir el privado').toBeLessThan(iDm)
  })

  it('el agente de comentarios trae la columna que hace falta', () => {
    const link = readFileSync(
      join(process.cwd(), 'src', 'lib', 'instagram-agent', 'agent-link.ts'),
      'utf8',
    )
    // Sin la columna en el SELECT, el campo llega undefined y la puerta no
    // frena nada — el modo de falla más silencioso posible.
    expect(link).toContain('requires_approval')
    expect(/const AGENT_BASE =[\s\S]{0,300}requires_approval/.test(link)).toBe(true)
  })
})
