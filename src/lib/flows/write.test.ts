import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { guardarGrafo } from './write'

/**
 * El borrado de pasos no se puede filtrar por cuenta —`flow_nodes` no lleva
 * workspace— y corre con el cliente de servicio. El UPDATE de arriba sí filtra,
 * pero un menú ajeno le devuelve cero filas SIN error, así que el guardado
 * seguía de largo: un flowId de otro comercio alcanzaba para dejarle el menú
 * sin pasos, en silencio y con respuesta 200.
 */

const WS = '11111111-1111-1111-1111-111111111111'
const OTRA = '22222222-2222-2222-2222-222222222222'
const FLUJO = '33333333-3333-3333-3333-333333333333'

interface Store {
  flows: Array<Record<string, unknown>>
  flow_nodes: Array<Record<string, unknown>>
  flow_versions: Array<Record<string, unknown>>
}

let store: Store

function nuevoStore(): Store {
  return {
    flows: [
      {
        id: FLUJO,
        workspace_id: WS,
        name: 'Menú principal',
        status: 'draft',
        entry_node_id: 'saludo',
        updated_at: null,
        deleted_at: null,
      },
    ],
    flow_nodes: [
      { flow_id: FLUJO, node_key: 'saludo', node_type: 'send_message', config: {} },
      { flow_id: FLUJO, node_key: 'fin', node_type: 'end', config: {} },
    ],
    flow_versions: [],
  }
}

/** Supabase de mentira: filtra, aplica y devuelve, con las cadenas que se usan. */
function fakeDb(): SupabaseClient {
  const api = {
    from(table: keyof Store) {
      const q = {
        op: 'select' as 'select' | 'insert' | 'update' | 'delete',
        filtros: [] as Array<[string, unknown]>,
        payload: null as unknown,
      }
      const filas = () =>
        (store[table] ?? []).filter((row) =>
          q.filtros.every(([col, val]) => (row as Record<string, unknown>)[col] === val),
        )
      const resolver = () => {
        if (q.op === 'insert') {
          const nuevas = Array.isArray(q.payload) ? q.payload : [q.payload]
          store[table].push(...(nuevas as Array<Record<string, unknown>>))
          return nuevas as Array<Record<string, unknown>>
        }
        if (q.op === 'update') {
          const alcanzadas = filas()
          for (const row of alcanzadas) Object.assign(row, q.payload)
          return alcanzadas
        }
        if (q.op === 'delete') {
          const fuera = new Set(filas())
          store[table] = store[table].filter((row) => !fuera.has(row))
          return []
        }
        return filas()
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        is: () => chain,
        insert(payload: unknown) {
          q.op = 'insert'
          q.payload = payload
          return chain
        },
        update(payload: unknown) {
          q.op = 'update'
          q.payload = payload
          return chain
        },
        delete() {
          q.op = 'delete'
          return chain
        },
        eq(col: string, val: unknown) {
          q.filtros.push([col, val])
          return chain
        },
        maybeSingle: async () => ({ data: resolver()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve({ data: resolver(), error: null }).then(ok, fail),
      }
      return chain
    },
  }
  return api as unknown as SupabaseClient
}

const db = fakeDb()

beforeEach(() => {
  store = nuevoStore()
})

describe('guardarGrafo', () => {
  it('reemplaza los pasos del menú de la cuenta', async () => {
    await guardarGrafo(db, {
      flowId: FLUJO,
      workspaceId: WS,
      campos: { name: 'Menú nuevo' },
      nodos: [{ node_key: 'unico', node_type: 'end', config: {} }],
    })

    expect(store.flow_nodes.map((n) => n.node_key)).toEqual(['unico'])
    expect(store.flows[0].name).toBe('Menú nuevo')
  })

  it('un menú de otra cuenta no se guarda ni se queda sin pasos', async () => {
    await expect(
      guardarGrafo(db, {
        flowId: FLUJO,
        workspaceId: OTRA,
        campos: { name: 'Secuestrado' },
        nodos: [],
      }),
    ).rejects.toThrow(/no existe en esta cuenta/)

    expect(store.flow_nodes).toHaveLength(2)
    expect(store.flows[0].name).toBe('Menú principal')
    expect(store.flow_versions).toHaveLength(0)
  })

  it('sin `nodos` sólo se toca el encabezado', async () => {
    await guardarGrafo(db, {
      flowId: FLUJO,
      workspaceId: WS,
      campos: { entry_node_id: 'fin' },
    })

    expect(store.flow_nodes).toHaveLength(2)
    expect(store.flows[0].entry_node_id).toBe('fin')
  })
})
