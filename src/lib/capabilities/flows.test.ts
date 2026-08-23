import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { aplicarPatches, cambiarEstado } from '@/lib/flows/write'
import { FLOW_CAPABILITIES } from './flows'
import type { CapabilityContext } from './types'

/**
 * Lo que se prueba acá es la promesa del módulo: un menú no queda peor de como
 * estaba.
 *
 * `ai-patches.ts` ya simulaba y revalidaba, pero nunca escribía — el que
 * guardaba era un humano mirando el lienzo. Al conectarlo a la base, el orden
 * de las tres puertas (patch bien formado → sin errores nuevos → si está activo,
 * entero) deja de ser una preferencia y pasa a ser lo único que separa "el chat
 * editó un menú" de "el chat dejó un menú roto contestándole a clientes".
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

function nuevoStore(over: Record<string, unknown> = {}): Store {
  return {
    flows: [
      {
        id: FLUJO,
        short_id: FLUJO.slice(0, 8),
        workspace_id: WS,
        name: 'Menú principal',
        description: null,
        status: 'draft',
        trigger_type: 'first_inbound_message',
        trigger_config: {},
        entry_node_id: 'saludo',
        execution_count: 0,
        last_executed_at: null,
        updated_at: null,
        deleted_at: null,
        ...over,
      },
    ],
    flow_nodes: [
      {
        flow_id: FLUJO,
        node_key: 'saludo',
        node_type: 'send_message',
        config: { text: 'Hola', next_node_key: 'fin' },
        position_x: 100,
        position_y: 40,
      },
      {
        flow_id: FLUJO,
        node_key: 'fin',
        node_type: 'end',
        config: {},
        position_x: 420,
        position_y: 40,
      },
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
        is(col: string, val: unknown) {
          q.filtros.push([col, val])
          return chain
        },
        maybeSingle: async () => ({ data: resolver()[0] ?? null, error: null }),
        single: async () => ({ data: resolver()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
          Promise.resolve({ data: resolver(), error: null }).then(ok, fail),
      }
      return chain
    },
  }
  return api as unknown as SupabaseClient
}

const db = fakeDb()
const ctx: CapabilityContext = {
  db,
  workspaceId: WS,
  actor: { type: 'operator', id: null },
}
const cap = (key: string) => FLOW_CAPABILITIES.find((c) => c.key === key)!

const nodo = (clave: string) => store.flow_nodes.find((n) => n.node_key === clave)

beforeEach(() => {
  store = nuevoStore()
})

describe('aplicarPatches', () => {
  it('guarda el cambio y conserva la posición de lo que ya estaba', async () => {
    const r = await aplicarPatches(db, {
      flowId: FLUJO,
      workspaceId: WS,
      patches: [
        { kind: 'update_node_config', node_key: 'saludo', config_patch: { text: 'Buenas' } },
      ],
    })

    expect(r.aplicados).toBe(1)
    expect((nodo('saludo')?.config as { text: string }).text).toBe('Buenas')
    // El merge es superficial: la conexión que no se tocó sigue ahí.
    expect((nodo('saludo')?.config as { next_node_key: string }).next_node_key).toBe('fin')
    expect(nodo('saludo')?.position_x).toBe(100)
    expect(store.flow_versions).toHaveLength(1)
    expect(store.flow_versions[0].kind).toBe('draft')
  })

  it('un paso nuevo sin coordenadas cae a la derecha del último', async () => {
    await aplicarPatches(db, {
      flowId: FLUJO,
      workspaceId: WS,
      patches: [
        {
          kind: 'add_node',
          node_key: 'gracias',
          node_type: 'send_message',
          config: { text: 'Gracias', next_node_key: 'fin' },
        },
        { kind: 'wire', from_node_key: 'saludo', kind_of_port: 'text', to_node_key: 'gracias' },
      ],
    })

    // Sin esto todos los pasos que agrega el chat caerían apilados en el (0,0).
    expect(nodo('gracias')?.position_x).toBe(420 + 320)
    expect((nodo('saludo')?.config as { next_node_key: string }).next_node_key).toBe('gracias')
  })

  it('no guarda nada si los cambios rompen algo que hoy funciona', async () => {
    await expect(
      aplicarPatches(db, {
        flowId: FLUJO,
        workspaceId: WS,
        patches: [
          { kind: 'wire', from_node_key: 'saludo', kind_of_port: 'text', to_node_key: 'fantasma' },
        ],
      }),
    ).rejects.toThrow(/romperían/)
    expect((nodo('saludo')?.config as { next_node_key: string }).next_node_key).toBe('fin')
    expect(store.flow_versions).toHaveLength(0)
  })

  it('rechaza la tanda entera si un patch viene incompleto', async () => {
    // `/assist` los descarta en silencio porque sólo propone. Acá no: quien
    // pidió el cambio se quedaría creyendo que se hizo algo que nunca pasó.
    await expect(
      aplicarPatches(db, {
        flowId: FLUJO,
        workspaceId: WS,
        patches: [
          { kind: 'update_node_config', node_key: 'saludo', config_patch: { text: 'Buenas' } },
          { kind: 'add_node', node_key: 'roto' },
        ],
      }),
    ).rejects.toThrow(/incompletos/)
    expect((nodo('saludo')?.config as { text: string }).text).toBe('Hola')
  })

  it('no toca el menú de otra cuenta', async () => {
    await expect(
      aplicarPatches(db, {
        flowId: FLUJO,
        workspaceId: OTRA,
        patches: [
          { kind: 'update_node_config', node_key: 'saludo', config_patch: { text: 'Buenas' } },
        ],
      }),
    ).rejects.toThrow(/no existe en esta cuenta/)
    expect((nodo('saludo')?.config as { text: string }).text).toBe('Hola')
  })

  it('un menú activo tiene que quedar entero, no sólo "no peor"', async () => {
    // Está atendiendo clientes ahora: un error que venía de antes deja de ser
    // tolerable en el momento en que alguien lo edita.
    store = nuevoStore({ status: 'active', entry_node_id: null })
    await expect(
      aplicarPatches(db, {
        flowId: FLUJO,
        workspaceId: WS,
        patches: [
          { kind: 'update_node_config', node_key: 'saludo', config_patch: { text: 'Buenas' } },
        ],
      }),
    ).rejects.toThrow(/está activo/)
    expect((nodo('saludo')?.config as { text: string }).text).toBe('Hola')
  })

  it('acepta el id corto de 8 que usan los enlaces', async () => {
    const r = await aplicarPatches(db, {
      flowId: FLUJO.slice(0, 8),
      workspaceId: WS,
      patches: [{ kind: 'set_trigger', trigger_type: 'keyword', trigger_config: { keywords: ['menu'] } }],
    })
    expect(r.disparador.config).toEqual({ keywords: ['menu'] })
    expect(store.flows[0].trigger_type).toBe('keyword')
  })
})

describe('cambiarEstado', () => {
  it('se niega a prender un menú incompleto y dice qué falta', async () => {
    store = nuevoStore({ entry_node_id: null })
    const r = await cambiarEstado(db, { flowId: FLUJO, workspaceId: WS, estado: 'active' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.severity === 'error')).toBe(true)
    expect(store.flows[0].status).toBe('draft')
  })

  it('al prender deja la versión publicada', async () => {
    const r = await cambiarEstado(db, { flowId: FLUJO, workspaceId: WS, estado: 'active' })
    expect(r.ok).toBe(true)
    expect(store.flows[0].status).toBe('active')
    expect(store.flow_versions[0]?.kind).toBe('published')
  })

  it('pausar no valida nada: hay que poder frenar algo roto', async () => {
    store = nuevoStore({ status: 'active', entry_node_id: null })
    const r = await cambiarEstado(db, { flowId: FLUJO, workspaceId: WS, estado: 'draft' })
    expect(r.ok).toBe(true)
    expect(store.flows[0].status).toBe('draft')
  })
})

describe('capacidades de flujos', () => {
  it('ninguna pide la cuenta como argumento', () => {
    for (const c of FLOW_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
    }
  })

  it('prender es irreversible y trae preview', () => {
    const activar = cap('flujos.activar')
    expect(activar.risk).toBe('irreversible')
    expect(typeof activar.preview).toBe('function')
  })

  it('ninguna se declara inerte: se propone y decide una persona', () => {
    for (const c of FLOW_CAPABILITIES.filter((x) => x.risk !== 'lectura')) {
      expect(c.inerte, c.key).toBeUndefined()
    }
  })

  it('el detalle dice qué le falta al menú para prenderse', async () => {
    store = nuevoStore({ entry_node_id: null })
    const r = (await cap('flujos.detalle').run(ctx, { flujo_id: FLUJO })) as {
      nodos: Array<{ clave: string; resumen: string }>
      problemas: Array<{ gravedad: string }>
    }
    expect(r.nodos[0].resumen).toContain('Hola')
    expect(r.problemas.some((p) => p.gravedad === 'error')).toBe(true)
  })

  it('el preview de prender se niega antes de gastarle el click a nadie', async () => {
    store = nuevoStore({ entry_node_id: null })
    // Lanza y no devuelve: si devolviera el motivo, quedaría una tarjeta con
    // ese texto donde va la descripción y su botón de aprobar intacto.
    await expect(
      cap('flujos.activar').preview!(ctx, { flujo_id: FLUJO, activo: true }),
    ).rejects.toThrow(/todavía no se puede prender/)
  })

  it('el artefacto dibuja sólo lo que se toca, antes y después', async () => {
    const args = {
      flujo_id: FLUJO,
      patches: [
        { kind: 'update_node_config', node_key: 'saludo', config_patch: { text: 'Buenas' } },
      ],
    }
    const editar = cap('flujos.editar')

    // El "antes" sale de la base; el "después", de los patches. Las dos listas
    // tienen las mismas claves: es lo que hace que el diff marque "editado" en
    // vez de inventar un paso nuevo y otro borrado.
    const antes = await editar.artifactBefore!(ctx, args)
    expect(antes?.kind).toBe('flujo')
    if (antes?.kind === 'flujo') {
      expect(antes.nodos.map((n) => n.clave)).toEqual(['saludo'])
      expect(antes.nodos[0].resumen).toContain('Hola')
    }

    const propuesto = editar.artifact!(ctx, args)
    expect(propuesto?.kind).toBe('flujo')
    if (propuesto?.kind === 'flujo') {
      expect(propuesto.nodos.map((n) => n.clave)).toEqual(['saludo'])
      expect(propuesto.nodos[0].resumen).toContain('Buenas')
    }

    const hecho = await editar.run(ctx, args)
    const despues = editar.artifact!(ctx, args, hecho)
    if (despues?.kind === 'flujo') {
      expect(despues.nombre).toBe('Menú principal')
      expect(despues.nodos.map((n) => n.clave)).toEqual(['saludo'])
      expect(despues.nodos[0].resumen).toContain('Buenas')
    }
  })
})
