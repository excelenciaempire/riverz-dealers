import { describe, expect, it } from 'vitest'

import type { CapabilityContext } from '@/lib/capabilities/types'
import type { OperatorEvent } from '../events'
import { crearPresupuesto } from './budget'
import { fakeDb } from './fake-db'
import { diferido, fakeRunner, type ActoGuion } from './fake-runner'
import { runOrquestador } from './orchestrator'

/**
 * Una cadena de encargos, sin plan.
 *
 * Es el camino normal desde que el plan quedó reservado para el trabajo ANCHO
 * (muchas cosas del mismo tipo) en vez de para cualquier cosa que toque dos
 * dominios. Antes esto no lo cubría ninguna prueba: la cadena existía en el
 * código y no la recorría nadie.
 *
 * Lo que se prueba es la propiedad que hace mejor a la cadena que al plan: lo
 * que devolvió el primer especialista **llega a la vuelta siguiente del
 * orquestador**, así que el encargo del segundo se escribe con el nombre exacto
 * en la mano — y no con un mapa de referencias que viaja por tres contextos.
 *
 * El 2026-08-24, con plan, un especialista murió, el de al lado parafraseó el
 * error y el turno se cerró diciendo «2 pasos listos» sin haber hecho nada.
 */

const PIDE_PLANTILLA: ActoGuion = {
  texto: 'Escribo el mensaje y después armo la automatización.',
  usa: [
    {
      name: 'equipo__delegar',
      input: { subagente: 'plantillas', encargo: 'Escribe el recordatorio de recompra.' },
    },
  ],
}

const PIDE_AUTOMATIZACION: ActoGuion = {
  usa: [
    {
      name: 'equipo__delegar',
      input: {
        subagente: 'automatizaciones',
        encargo: 'Arma la recompra a 21 días que manda «recompra_serum_1u».',
      },
    },
  ],
}

function correr(guiones: Record<string, ActoGuion[]>) {
  const eventos: OperatorEvent[] = []
  const fake = fakeRunner(guiones)
  const db = fakeDb()
  const ctx: CapabilityContext = {
    db: db.db,
    workspaceId: 'ws-1',
    actor: { type: 'operator', id: 'u-1' },
    locale: 'es',
  }
  return {
    fake,
    eventos,
    promesa: runOrquestador({
      ctx,
      threadId: 'th-1',
      history: [{ role: 'user', content: 'arma la recompra del serum' }],
      pedido: 'arma la recompra del serum',
      runner: fake.runner,
      emit: (e) => eventos.push(e),
      presupuesto: crearPresupuesto(),
      autoBuild: false,
    }),
  }
}

describe('encargos encadenados, sin pasar por un plan', () => {
  it('lo que dejó el primero llega a la vuelta siguiente del orquestador', async () => {
    const { fake, promesa } = correr({
      orquestador: [PIDE_PLANTILLA, PIDE_AUTOMATIZACION, { texto: 'Listo.' }],
      plantillas: [{ texto: 'Escrita «recompra_serum_1u».' }],
      automatizaciones: [{ texto: 'Armada, pausada.' }],
    })
    await promesa

    const delOrquestador = fake.llamadas.filter((l) => l.quien === 'orquestador')
    expect(delOrquestador.length).toBeGreaterThanOrEqual(2)
    // La segunda vuelta ya trae lo que contestó plantillas.
    expect(delOrquestador[1].contexto).toContain('recompra_serum_1u')
  })

  it('la cadena no consume las vueltas de razonamiento: los dos trabajan', async () => {
    const { fake, promesa } = correr({
      orquestador: [PIDE_PLANTILLA, PIDE_AUTOMATIZACION, { texto: 'Listo.' }],
      plantillas: [{ texto: 'Escrita «recompra_serum_1u».' }],
      automatizaciones: [{ texto: 'Armada, pausada.' }],
    })
    await promesa

    const quienes = fake.llamadas.map((l) => l.quien)
    expect(quienes).toContain('plantillas')
    expect(quienes).toContain('automatizaciones')
    // Y en ese orden: el segundo encargo se escribe DESPUÉS de leer el primero.
    expect(quienes.indexOf('plantillas')).toBeLessThan(quienes.indexOf('automatizaciones'))
  })

  it('sin plan de por medio, no hay tarjeta que aprobar antes de empezar', async () => {
    const { eventos, promesa } = correr({
      orquestador: [PIDE_PLANTILLA, PIDE_AUTOMATIZACION, { texto: 'Listo.' }],
      plantillas: [{ texto: 'Escrita «recompra_serum_1u».' }],
      automatizaciones: [{ texto: 'Armada, pausada.' }],
    })
    const r = await promesa

    expect(r.planId).toBeUndefined()
    expect(eventos.some((e) => e.t === 'plan')).toBe(false)
  })

  it('dos encargos independientes en el mismo mensaje corren a la vez', async () => {
    // Con diferidos y sin relojes: los dos se quedan colgados adentro del
    // runner hasta que la prueba los suelta, que es la unica forma de mirar la
    // concurrencia sin que la maquina ocupada haga fallar la prueba sola.
    const d1 = diferido()
    const d2 = diferido()
    const { fake, promesa } = correr({
      orquestador: [
        {
          usa: [
            {
              name: 'equipo__delegar',
              input: { subagente: 'plantillas', encargo: 'Escribe el recordatorio.' },
            },
            {
              name: 'equipo__delegar',
              input: { subagente: 'contactos', encargo: 'Cuenta el público.' },
            },
          ],
        },
        { texto: 'Listo.' },
      ],
      plantillas: [{ espera: d1, texto: 'Escrita.' }],
      contactos: [{ espera: d2, texto: 'Son 420.' }],
    })
    // Que las dos lleguen al runner antes de soltarlas.
    for (let i = 0; i < 40; i++) await Promise.resolve()
    expect(fake.simultaneas.ahora).toBe(2)
    d1.soltar()
    d2.soltar()
    await promesa

    expect(fake.simultaneas.max).toBe(2)
  })

  it('si un especialista se cae, el orquestador se entera en la misma vuelta', async () => {
    const { fake, promesa } = correr({
      orquestador: [PIDE_PLANTILLA, { texto: 'No pude escribir el mensaje.' }],
      plantillas: [{ falla: 'el modelo contestó 400' }],
    })
    await promesa

    // El error viaja en el resultado de la herramienta, en el contexto del que
    // decide — no parafraseado por un tercero dos saltos más allá.
    const delOrquestador = fake.llamadas.filter((l) => l.quien === 'orquestador')
    expect(delOrquestador[1].contexto).toContain('400')
  })
})
