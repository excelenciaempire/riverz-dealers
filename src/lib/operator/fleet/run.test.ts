import { describe, expect, it } from 'vitest'

import type { CapabilityContext } from '@/lib/capabilities/types'
import type { OperatorEvent } from '../events'
import { crearPresupuesto } from './budget'
import { fakeDb } from './fake-db'
import { USO_FALSO, fakeRunner } from './fake-runner'
import { runSubagent } from './run'
import { specDe } from './roster'
import type { SubagentId } from './types'

/**
 * Un subagente trabajando.
 *
 * Todo contra un modelo de mentira y una base de mentira: sin red, sin base y
 * sin gastar un token. Lo que se prueba no es que el modelo acierte —eso no se
 * puede probar acá— sino que el andamio se comporte: que respete su dominio,
 * que escriba por el camino correcto, que el texto salga por el canal del
 * equipo y no por el del hilo, y que lo que le pasa al paso siguiente sean
 * datos duros y no una frase.
 */

function correr(
  agente: SubagentId,
  guion: Parameters<typeof fakeRunner>[0],
  opts: { autoBuild?: boolean; hechos?: never[] } = {},
) {
  const eventos: OperatorEvent[] = []
  const fake = fakeRunner(guion)
  const db = fakeDb()
  const ctx: CapabilityContext = {
    db: db.db,
    workspaceId: 'ws-1',
    actor: { type: 'operator', id: 'u-1' },
    locale: 'es',
  }
  const presupuesto = crearPresupuesto()

  const promesa = runSubagent({
    agente,
    encargo: { texto: 'hacé la cosa', hechos: [] },
    ctx,
    threadId: 'th-1',
    runner: fake.runner,
    emit: (e) => eventos.push(e),
    presupuesto,
    autoBuild: opts.autoBuild ?? false,
  })

  return { promesa, eventos, fake, db, presupuesto }
}

describe('el andamio de un subagente', () => {
  it('avisa cuándo empieza y cuándo termina', async () => {
    const { promesa, eventos } = correr('plantillas', {
      plantillas: [{ texto: 'Listo, no habia nada que hacer.' }],
    })
    const r = await promesa

    expect(eventos[0]).toMatchObject({ t: 'agente_inicio', agente: 'plantillas' })
    expect(eventos.at(-1)).toMatchObject({ t: 'agente_fin', agente: 'plantillas', ok: true })
    expect(r.ok).toBe(true)
  })

  it('lo que dice va por el canal del equipo, nunca por el del hilo', async () => {
    // La regla que impide que dos subagentes se peguen las frases dentro del
    // mismo párrafo del chat.
    const { promesa, eventos } = correr('contactos', {
      contactos: [{ texto: 'Miro las etiquetas.\nDespues cuento el publico.' }],
    })
    await promesa

    expect(eventos.some((e) => e.t === 'text')).toBe(false)
    const dichos = eventos.filter((e) => e.t === 'agente_dice')
    expect(dichos.length).toBeGreaterThan(0)
    expect(dichos.every((e) => 'agente' in e && e.agente === 'contactos')).toBe(true)
  })

  it('parte lo que dice en líneas completas, sin perder la última', async () => {
    // La última frase casi nunca termina en salto de línea, y es justo la que
    // resume el trabajo.
    const { promesa, eventos } = correr('contactos', {
      contactos: [{ texto: 'Primera linea.\nSegunda linea sin salto final' }],
    })
    await promesa

    const textos = eventos.filter((e) => e.t === 'agente_dice').map((e) => e.texto)
    expect(textos).toEqual(['Primera linea.', 'Segunda linea sin salto final'])
  })

  it('sólo recibe las herramientas de su dominio', async () => {
    const { promesa, fake } = correr('plantillas', {
      plantillas: [{ texto: 'listo' }],
    })
    await promesa

    const tools = fake.llamadas[0].tools
    expect(tools.every((t) => t.startsWith('plantillas__'))).toBe(true)
    expect(tools).not.toContain('automatizaciones__crear')
  })

  it('rechaza lo que no es de su dominio en vez de intentarlo', async () => {
    // El nombre de la herramienta lo elige el modelo. Si pide una ajena, la
    // respuesta es un error explicado, no un intento.
    const { promesa, db } = correr('plantillas', {
      plantillas: [
        { usa: [{ name: 'automatizaciones__crear', input: { nombre: 'x' } }] },
        { texto: 'Eso no me toca.' },
      ],
    })
    const r = await promesa

    expect(r.ok).toBe(true)
    expect(db.en('operator_actions')).toHaveLength(0)
  })

  it('lo que cambia algo queda propuesto, no hecho', async () => {
    // Con `autoBuild` apagado, hasta lo inerte espera un click.
    const { promesa, eventos, db } = correr('contactos', {
      contactos: [
        {
          usa: [
            {
              name: 'segmentos__crear',
              input: { nombre: 'Recurrentes', reglas: [{ type: 'shopify', op: 'is_customer' }] },
            },
          ],
        },
        { texto: 'Quedo esperando tu aprobacion.' },
      ],
    })
    const r = await promesa

    expect(r.propuestas).toBe(1)
    expect(r.construidas).toBe(0)
    expect(eventos.some((e) => e.t === 'proposed' && e.agente === 'contactos')).toBe(true)
    const filas = db.en('operator_actions')
    expect(filas).toHaveLength(1)
    expect(filas[0].status).toBe('propuesto')
  })

  it('con el plan aprobado construye lo inerte y lo dice', async () => {
    const { promesa, eventos, db } = correr(
      'contactos',
      {
        contactos: [
          {
            usa: [
              {
                name: 'segmentos__crear',
                input: { nombre: 'Recurrentes', reglas: [{ type: 'shopify', op: 'is_customer' }] },
              },
            ],
          },
          { texto: 'Segmento **Recurrentes** creado.' },
        ],
      },
      { autoBuild: true },
    )
    const r = await promesa

    expect(r.construidas).toBe(1)
    expect(r.propuestas).toBe(0)
    expect(eventos.some((e) => e.t === 'built')).toBe(true)
    expect(db.en('operator_actions')[0].status).toBe('ejecutado')
  })

  it('el gasto queda atribuido a él, no al orquestador', async () => {
    const { promesa, presupuesto } = correr('plantillas', {
      plantillas: [{ texto: 'listo' }],
    })
    await promesa

    expect(presupuesto.porAgente().plantillas).toMatchObject({
      prompt: USO_FALSO.input_tokens,
      completion: USO_FALSO.output_tokens,
      llamadas: 1,
    })
    expect(presupuesto.porAgente().orquestador).toBeUndefined()
  })

  it('no se pasa de sus vueltas aunque el modelo siga pidiendo', async () => {
    // Un subagente que pide herramientas para siempre tiene que cortar solo.
    const { promesa, fake } = correr('contactos', {
      contactos: [{ usa: [{ name: 'etiquetas__listar', input: {} }] }],
    })
    await promesa

    // Sale del roster: lo que importa es que corte solo, no el número exacto.
    expect(fake.llamadas.length).toBeLessThanOrEqual(specDe('contactos').maxIters)
  })

  it('si el modelo explota, lo cuenta en vez de tumbar el turno', async () => {
    const { promesa, eventos } = correr('voz', {
      voz: [{ falla: 'se corto la conexion' }],
    })
    const r = await promesa

    expect(r.ok).toBe(false)
    expect(r.error).toContain('se corto')
    expect(eventos.at(-1)).toMatchObject({ t: 'agente_fin', ok: false })
  })

  it('se planta cuando se acaba el presupuesto', async () => {
    const eventos: OperatorEvent[] = []
    const fake = fakeRunner({ plantillas: [{ texto: 'listo' }] })
    const db = fakeDb()
    // Un presupuesto que ya nace agotado.
    const presupuesto = crearPresupuesto(0)

    const r = await runSubagent({
      agente: 'plantillas',
      encargo: { texto: 'hacé la cosa', hechos: [] },
      ctx: {
        db: db.db,
        workspaceId: 'ws-1',
        actor: { type: 'operator', id: 'u-1' },
        locale: 'es',
      },
      threadId: 'th-1',
      runner: fake.runner,
      emit: (e) => eventos.push(e),
      presupuesto,
      autoBuild: false,
    })

    expect(fake.llamadas).toHaveLength(0)
    expect(r.ok).toBe(true)
    expect(r.resumen).toContain('presupuesto')
  })
})

describe('lo que le deja al paso siguiente', () => {
  it('pasa datos duros, no una frase', async () => {
    // Es el punto de todo el pizarrón: el de automatizaciones necesita el
    // NOMBRE EXACTO de la plantilla, y ahí es donde un modelo inventa uno
    // parecido. Sale del resultado real, calculado por el servidor.
    const { promesa } = correr(
      'contactos',
      {
        contactos: [
          {
            usa: [
              {
                name: 'segmentos__crear',
                input: { nombre: 'Recurrentes', reglas: [{ type: 'shopify', op: 'is_customer' }] },
              },
            ],
          },
          { texto: 'Listo.' },
        ],
      },
      { autoBuild: true },
    )
    const r = await promesa

    // El stub devuelve los args como resultado, así que el nombre viaja.
    expect(r.refs?.segmento).toBe('Recurrentes')
  })

  it('el resumen se recorta para no inundar al siguiente', async () => {
    const largo = 'x'.repeat(400)
    const { promesa } = correr('voz', { voz: [{ texto: largo }] })
    const r = await promesa
    expect(r.resumen.length).toBeLessThanOrEqual(240)
  })
})
