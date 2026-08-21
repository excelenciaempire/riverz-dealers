import { describe, expect, it } from 'vitest'

import type { CapabilityContext } from '@/lib/capabilities/types'
import type { OperatorEvent } from '../events'
import { crearPresupuesto } from './budget'
import { fakeDb } from './fake-db'
import { fakeRunner, type ActoGuion } from './fake-runner'
import { runOrquestador } from './orchestrator'

/**
 * Lo que el orquestador escribe en el hilo.
 *
 * El turno son varias llamadas al modelo y el hilo las muestra como un solo
 * mensaje. Las dos reglas que se prueban acá salieron de mirar corridas reales
 * en pantalla, no de leer el código: las frases salían pegadas, y después de
 * dejar un plan escribía otro párrafo diciendo lo mismo que el de arriba.
 */

const PLAN: ActoGuion = {
  texto: 'Reviso qué hay y reparto.',
  usa: [
    {
      name: 'equipo__plan',
      input: {
        porque: 'la automatización necesita la plantilla',
        pasos: [
          { subagente: 'plantillas', encargo: 'Escribe la plantilla de carrito.' },
          { subagente: 'automatizaciones', encargo: 'Arma el rescate.', depende_de: [0] },
        ],
      },
    },
  ],
}

function correr(guion: ActoGuion[]) {
  const eventos: OperatorEvent[] = []
  const fake = fakeRunner({ orquestador: guion })
  const db = fakeDb()
  const ctx: CapabilityContext = {
    db: db.db,
    workspaceId: 'ws-1',
    actor: { type: 'operator', id: 'u-1' },
    locale: 'es',
  }
  const promesa = runOrquestador({
    ctx,
    threadId: 'th-1',
    history: [{ role: 'user', content: 'arma el rescate de carritos' }],
    pedido: 'arma el rescate de carritos',
    runner: fake.runner,
    emit: (e) => eventos.push(e),
    presupuesto: crearPresupuesto(),
    autoBuild: false,
  })
  const dicho = () =>
    eventos
      .filter((e): e is Extract<OperatorEvent, { t: 'text' }> => e.t === 'text')
      .map((e) => e.delta)
      .join('')
  return { promesa, eventos, dicho }
}

describe('el texto del orquestador en el hilo', () => {
  it('después de dejar el plan, se calla', async () => {
    // La tarjeta con los pasos y el botón ya está en pantalla. El párrafo que
    // el modelo escribe después repite el mismo bloqueo que ya contó arriba.
    const { promesa, dicho } = correr([PLAN, { texto: 'El plan quedó esperando aprobación.' }])
    const r = await promesa

    expect(dicho()).toContain('Reviso qué hay y reparto.')
    expect(dicho()).not.toContain('esperando aprobación')
    expect(r.text).toBe('Reviso qué hay y reparto.')
    expect(r.planId).toBeTruthy()
  })

  it('pero no lo deja mudo si todavía no había dicho nada', async () => {
    // Un plan sin una palabra alrededor deja la tarjeta sola, y ahí sí hace
    // falta la frase.
    const mudoAntes: ActoGuion = { ...PLAN, texto: undefined }
    const { promesa, dicho } = correr([mudoAntes, { texto: 'Falta conectar WhatsApp.' }])
    const r = await promesa

    expect(dicho()).toContain('Falta conectar WhatsApp.')
    expect(r.text).toBe('Falta conectar WhatsApp.')
  })

  it('separa lo que dice en dos llamadas distintas', async () => {
    // Sin esto salían pegadas: "…antes de enviarla.Dejé el plan esperando".
    const { promesa, dicho } = correr([
      { texto: 'Primero miro.', usa: [{ name: 'automatizaciones__listar', input: {} }] },
      { texto: 'Ya está.' },
    ])
    await promesa

    expect(dicho()).toBe('Primero miro.\n\nYa está.')
  })
})
