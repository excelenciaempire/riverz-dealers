import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lo que cuida esta prueba, que es distinto de lo que cuida `ai-patches.test.ts`.
 *
 * Allá se prueba el DSL sobre un árbol en memoria. Acá se prueba lo que rodea a
 * ese DSL cuando hay una base de datos del otro lado:
 *
 *  1. Que la cuenta salga del contexto. Editar la automatización de otro
 *     comercio tiene que dar "no existe" ANTES de leer sus pasos, porque
 *     `loadStepsTree` va por el cliente de servicio y no sabe de cuentas.
 *  2. Que el `preview` no escriba. Es lo que lee la persona que aprueba.
 *  3. Que el panel reciba el diff y no un árbol para comparar de memoria.
 *  4. Que los `id` de los pasos que no se tocaron lleguen intactos a
 *     `replaceSteps`: son los que hacen que una corrida dormida en una espera
 *     vuelva a su paso y no al tronco.
 */

const loadStepsTree = vi.fn()
const replaceSteps = vi.fn()

vi.mock('@/lib/automations/steps-tree', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/automations/steps-tree')>()
  return {
    ...real,
    loadStepsTree: (...a: unknown[]) => loadStepsTree(...a),
    replaceSteps: (...a: unknown[]) => replaceSteps(...a),
  }
})

import { conDiff } from '@/lib/operator/artifacts-diff'
import { AUTOMATION_CAPABILITIES } from './automations'
import type { Capability, CapabilityContext } from './types'

const WS = '11111111-1111-1111-1111-111111111111'
const OTRA = '99999999-9999-9999-9999-999999999999'
const AUTO = '33333333-3333-3333-3333-333333333333'
const ETIQUETA = '44444444-4444-4444-4444-444444444444'

function cap(key: string): Capability {
  const c = AUTOMATION_CAPABILITIES.find((x) => x.key === key)
  if (!c) throw new Error(`falta la capacidad ${key}`)
  return c
}

const arbol = () => [
  { id: 'p1', step_type: 'wait', step_config: { amount: 15, unit: 'minutes' }, branches: { yes: [], no: [] } },
  {
    id: 'p2',
    step_type: 'send_message',
    step_config: { text: 'Te quedó algo en el carrito.' },
    branches: { yes: [], no: [] },
  },
  {
    id: 'p3',
    step_type: 'add_tag',
    step_config: { tag_id: ETIQUETA },
    branches: { yes: [], no: [] },
  },
]

interface Escritura {
  tabla: string
  filtros: Record<string, unknown>
  payload: Record<string, unknown>
}

function fakeDb(workspaceDeLaAutomatizacion = WS) {
  const escrituras: Escritura[] = []
  const api = {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {}
      let payload: Record<string, unknown> | null = null

      const resolver = () => {
        if (payload) {
          escrituras.push({ tabla, filtros, payload })
          return null
        }
        if (tabla === 'automations') {
          const mia =
            filtros.id === AUTO && filtros.workspace_id === workspaceDeLaAutomatizacion
          return mia
            ? {
                id: AUTO,
                name: 'Rescate de carrito',
                trigger_type: 'shopify_abandoned_checkout',
                trigger_config: {},
                is_active: true,
              }
            : null
        }
        if (tabla === 'tags') return [{ id: ETIQUETA, name: 'carrito-recuperado' }]
        return null
      }

      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        update: (v: Record<string, unknown>) => {
          payload = v
          return chain
        },
        eq: (c: string, v: unknown) => {
          filtros[c] = v
          return chain
        },
        is: (c: string, v: unknown) => {
          filtros[c] = v
          return chain
        },
        maybeSingle: async () => ({ data: resolver(), error: null }),
        then: (ok: (x: unknown) => unknown, mal?: (x: unknown) => unknown) =>
          Promise.resolve({ data: resolver(), error: null }).then(ok, mal),
      })
      return chain
    },
  }
  return { db: api as unknown as SupabaseClient, escrituras }
}

function ctx(db: SupabaseClient): CapabilityContext {
  return { db, workspaceId: WS, actor: { type: 'operator', id: 'u1' } }
}

const cambiarTexto = {
  automation_id: AUTO,
  patches: [{ op: 'cambiar_texto', paso: '2', texto: 'Te dejamos el carrito listo.' }],
}

beforeEach(() => {
  loadStepsTree.mockReset()
  replaceSteps.mockReset()
  loadStepsTree.mockImplementation(async () => arbol())
  replaceSteps.mockResolvedValue(null)
})

describe('la cuenta manda, no los argumentos', () => {
  it('la automatización de otro comercio no existe, y sus pasos no se leen', async () => {
    const { db } = fakeDb(OTRA)
    await expect(cap('automatizaciones.editar').run(ctx(db), cambiarTexto)).rejects.toThrow(
      /no existe en esta cuenta/,
    )
    expect(loadStepsTree).not.toHaveBeenCalled()
    expect(replaceSteps).not.toHaveBeenCalled()
  })

  it('no pide workspace_id como argumento', () => {
    for (const key of ['automatizaciones.ver', 'automatizaciones.editar']) {
      expect(Object.keys(cap(key).schema.properties), key).not.toContain('workspace_id')
    }
  })
})

describe('ver', () => {
  it('devuelve la ruta de cada paso y la etiqueta por su nombre', async () => {
    const { db } = fakeDb()
    const r = (await cap('automatizaciones.ver').run(ctx(db), {
      automation_id: AUTO,
    })) as { pasos: { ruta: string; que: string }[]; falta_para_prenderla: string[] }
    expect(r.pasos.map((p) => p.ruta)).toEqual(['1', '2', '3'])
    expect(r.pasos[2].que).toBe('Le pone la etiqueta «carrito-recuperado»')
    expect(r.falta_para_prenderla).toEqual([])
  })
})

describe('editar', () => {
  it('el preview cuenta el cambio y no escribe nada', async () => {
    const { db, escrituras } = fakeDb()
    const texto = await cap('automatizaciones.editar').preview!(ctx(db), cambiarTexto)
    expect(texto).toContain('Rescate de carrito')
    expect(texto).toContain('pasaría a decir')
    expect(texto).toContain('rige desde el próximo disparo')
    expect(escrituras).toEqual([])
    expect(replaceSteps).not.toHaveBeenCalled()
  })

  it('el panel recibe qué se movió, no el árbol de nuevo', async () => {
    const { db } = fakeDb()
    const c = cap('automatizaciones.editar')
    // El mismo orden que `escribir.ts` al proponer: preview, artifact, y recién
    // después el "antes".
    await c.preview!(ctx(db), cambiarTexto)
    const nuevo = c.artifact!(ctx(db), cambiarTexto)
    const previo = await c.artifactBefore!(ctx(db), cambiarTexto)
    const marcado = conDiff(previo, nuevo!)
    expect(marcado.kind).toBe('automatizacion')
    if (marcado.kind !== 'automatizacion') return
    expect(marcado.base?.id).toBe(AUTO)
    expect(marcado.pasos.map((p) => p.cambio)).toEqual(['igual', 'editado', 'igual'])
    expect(marcado.pasos[1].antes).toContain('Te quedó algo en el carrito.')
  })

  it('guarda el árbol nuevo conservando los ids de los pasos que no se tocaron', async () => {
    const { db } = fakeDb()
    await cap('automatizaciones.editar').run(ctx(db), cambiarTexto)
    expect(replaceSteps).toHaveBeenCalledTimes(1)
    const [id, pasos] = replaceSteps.mock.calls[0] as [
      string,
      { id: string; step_config: Record<string, unknown> }[],
    ]
    expect(id).toBe(AUTO)
    expect(pasos.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(pasos[1].step_config.text).toBe('Te dejamos el carrito listo.')
  })

  it('renombrar no le hace pasar a los pasos un borrado y reinserción', async () => {
    const { db, escrituras } = fakeDb()
    await cap('automatizaciones.editar').run(ctx(db), {
      automation_id: AUTO,
      patches: [{ op: 'renombrar', nombre: 'Rescate 2 horas' }],
    })
    expect(escrituras).toHaveLength(1)
    expect(escrituras[0].payload).toEqual({ name: 'Rescate 2 horas' })
    expect(replaceSteps).not.toHaveBeenCalled()
  })

  it('no aplica nada si dejaría la automatización sin poder prenderse', async () => {
    const { db, escrituras } = fakeDb()
    await expect(
      cap('automatizaciones.editar').run(ctx(db), {
        automation_id: AUTO,
        patches: [
          { op: 'quitar_paso', paso: '3' },
          { op: 'quitar_paso', paso: '2' },
          { op: 'quitar_paso', paso: '1' },
        ],
      }),
    ).rejects.toThrow(/sin poder prenderse/)
    expect(escrituras).toEqual([])
    expect(replaceSteps).not.toHaveBeenCalled()
  })

  it('un solo cambio mal formado cancela la edición entera', async () => {
    // Aplicar dos de tres deja una automatización que nadie pidió: la mitad de
    // un cambio no es un cambio más chico, es otro cambio.
    const { db } = fakeDb()
    await expect(
      cap('automatizaciones.editar').run(ctx(db), {
        automation_id: AUTO,
        patches: [
          { op: 'cambiar_texto', paso: '2', texto: 'Hola' },
          { op: 'mover_paso', paso: '1' },
        ],
      }),
    ).rejects.toThrow(/no entendí 1 de los 2/)
    expect(replaceSteps).not.toHaveBeenCalled()
  })
})
