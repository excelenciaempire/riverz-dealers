/**
 * Guardar un menú: el único lugar donde el grafo toca la base.
 *
 * `ai-patches.ts` ya sabía CAMBIAR un menú —simula los patches sobre una copia,
 * revalida y devuelve sólo los errores nuevos— pero no sabía guardarlo: el
 * endpoint `/assist` le devolvía los patches al navegador y el que escribía era
 * el humano al pulsar Guardar. Con eso, nada fuera del lienzo podía editar un
 * menú.
 *
 * Acá se cierra el círculo. `aplicarPatches` simula, revalida y RECIÉN AHÍ
 * escribe, con el mismo validador que usa el editor. La regla de oro es que un
 * menú no queda peor de como estaba: si los cambios introducen errores que antes
 * no existían, no se guarda nada.
 *
 * El cuerpo de `guardarGrafo` y `cambiarEstado` vivía adentro de los route
 * handlers (`PUT /api/flows/[id]` y `POST /api/flows/[id]/activate`). Se movió
 * sin cambiarle nada por el mismo motivo por el que existe la capa de
 * capacidades: dos caminos que escriben el mismo grafo terminan divergiendo, y
 * el que se olvida de validar es el que deja un menú activo y roto atendiendo
 * clientes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { idColumn } from '@/lib/short-id'
import {
  isPatch,
  simulateApplyPatches,
  validatePatchedSnapshot,
  type AiPatch,
  type FlowSnapshot,
} from './ai-patches'
import { validateFlowForActivation, type ValidationIssue } from './validate'
import { HttpFlowReviewRequiredError, httpFlowActivationIssues } from './http-activation'

/**
 * Cuánto se corre a la derecha un paso nuevo que no trae posición.
 *
 * Los nodos del lienzo miden ~260px de ancho. `simulateApplyPatches` ignora las
 * posiciones a propósito (sólo le importa el grafo lógico), así que si acá no se
 * calculara una, todos los pasos agregados por el chat caerían apilados en el
 * (0,0) y habría que desenredarlos a mano.
 */
const ANCHO_PASO = 320

export type EstadoFlujo = 'draft' | 'active' | 'archived'

export interface NodoGuardable {
  node_key: string
  node_type: string
  config: Record<string, unknown>
  position_x?: number
  position_y?: number
}

export interface FlujoGuardado {
  flow: Record<string, unknown> | null
  nodes: Array<Record<string, unknown>>
}

export interface FilaFlujo {
  id: string
  short_id: string | null
  name: string
  description: string | null
  status: EstadoFlujo
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual'
  trigger_config: Record<string, unknown>
  entry_node_id: string | null
  execution_count: number | null
  last_executed_at: string | null
  updated_at: string | null
}

/**
 * El menú y sus pasos, ya recortados a la cuenta.
 *
 * Acepta el id corto de 8 y el uuid completo: quien pide el cambio suele venir
 * del enlace de la pantalla, que usa el corto.
 */
export async function leerFlujo(
  db: SupabaseClient,
  flowId: string,
  workspaceId: string,
): Promise<{ flow: FilaFlujo; nodos: Required<NodoGuardable>[] } | null> {
  const { data } = await db
    .from('flows')
    .select(
      'id, short_id, name, description, status, trigger_type, trigger_config, entry_node_id, execution_count, last_executed_at, updated_at',
    )
    .eq(idColumn(flowId), flowId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  const flow = data as FilaFlujo | null
  if (!flow) return null

  const { data: filas } = await db
    .from('flow_nodes')
    .select('node_key, node_type, config, position_x, position_y')
    .eq('flow_id', flow.id)
    .order('created_at', { ascending: true })

  const nodos = ((filas ?? []) as Array<Partial<Required<NodoGuardable>>>).map((n) => ({
    node_key: String(n.node_key),
    node_type: String(n.node_type),
    config: (n.config ?? {}) as Record<string, unknown>,
    position_x: Number(n.position_x ?? 0),
    position_y: Number(n.position_y ?? 0),
  }))
  return { flow, nodos }
}

/**
 * Reemplaza el grafo y deja el snapshot del borrador.
 *
 * Borrar-e-insertar no es atómico y está asumido: el runner tolera leer en el
 * medio de una edición (un `node_not_found` termina la corrida limpio) y a
 * cambio no hay que llevar el diff de qué nodo cambió.
 *
 * `nodos` sin definir significa "no toques el grafo": el editor guarda sólo el
 * encabezado cuando se cambia el disparador, y ahí borrar los pasos sería
 * borrarlos de verdad.
 */
export async function guardarGrafo(
  db: SupabaseClient,
  input: {
    /** UUID completo, ya resuelto y verificado contra la cuenta. */
    flowId: string
    workspaceId: string
    /** Campos de `flows` a pisar. `updated_at` lo pone esta función. */
    campos?: Record<string, unknown>
    nodos?: NodoGuardable[]
    /** Quién guardó, para el historial de versiones. */
    userId?: string | null
    locale?: 'es' | 'en'
  },
): Promise<FlujoGuardado> {
  // Both the manual editor and assisted patches pass here. An active HTTP
  // graph must retain its reviewed configuration before any destructive graph write.
  if (input.nodos?.some(node => node.node_type === 'http_action')) {
    const current = await db.from('flows')
      .select('id, name, status, trigger_type, trigger_config, entry_node_id')
      .eq('id', input.flowId).eq('workspace_id', input.workspaceId).is('deleted_at', null).maybeSingle()
    if (current.error) throw new Error('http_flow_edit_unavailable')
    if (!current.data) throw new Error('ese menú no existe en esta cuenta')
    if (current.data.status === 'active') {
      const fields = { ...current.data, ...(input.campos ?? {}) } as FilaFlujo
      const issues = validateFlowForActivation({ name: fields.name, trigger_type: fields.trigger_type,
        trigger_config: fields.trigger_config ?? {}, entry_node_id: fields.entry_node_id }, input.nodos, input.locale)
      if (issues.some(issue => issue.severity === 'error')) throw new HttpFlowReviewRequiredError(input.locale)
      const httpIssues = await httpFlowActivationIssues(db, { workspaceId: input.workspaceId,
        flowId: input.flowId, actorId: input.userId, nodes: input.nodos, locale: input.locale })
      if (httpIssues.length) throw new HttpFlowReviewRequiredError(input.locale)
    }
  }
  // El `.select()` no es para leer: es para saber CUÁNTAS filas tocó. Un menú
  // de otra cuenta no matchea el filtro de workspace y Postgres no lo llama
  // error —cero filas, todo bien—, así que el guardado seguía de largo hasta el
  // borrado de pasos de abajo, que no tiene forma de filtrar por cuenta (los
  // pasos no llevan workspace) y corre con el cliente de servicio. Un flowId
  // ajeno alcanzaba para dejar sin pasos el menú de otro comercio, en silencio.
  const { data: tocadas, error: updErr } = await db
    .from('flows')
    .update({ ...(input.campos ?? {}), updated_at: new Date().toISOString() })
    .eq('id', input.flowId)
    .eq('workspace_id', input.workspaceId)
    .select('id')
  if (updErr) throw new Error(updErr.message)
  if (!Array.isArray(tocadas) || tocadas.length === 0) {
    throw new Error('ese menú no existe en esta cuenta')
  }

  if (input.nodos !== undefined) {
    const { error: delErr } = await db
      .from('flow_nodes')
      .delete()
      .eq('flow_id', input.flowId)
    if (delErr) throw new Error(delErr.message)

    if (input.nodos.length > 0) {
      const { error: insErr } = await db.from('flow_nodes').insert(
        input.nodos.map((n) => ({
          flow_id: input.flowId,
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config,
          position_x: n.position_x ?? 0,
          position_y: n.position_y ?? 0,
        })),
      )
      if (insErr) throw new Error(insErr.message)
    }
  }

  const [{ data: flow }, { data: nodes }] = await Promise.all([
    db.from('flows').select('*').eq('id', input.flowId).maybeSingle(),
    db
      .from('flow_nodes')
      .select('*')
      .eq('flow_id', input.flowId)
      .order('created_at', { ascending: true }),
  ])

  // Auto-snapshot del borrador: cada guardado reemplaza al anterior. Es lo que
  // le permite al comercio comparar "lo que estoy editando" contra "lo que está
  // publicado" sin acumular una fila por tecla.
  if (flow) {
    await db.from('flow_versions').delete().eq('flow_id', input.flowId).eq('kind', 'draft')
    await db.from('flow_versions').insert({
      flow_id: input.flowId,
      kind: 'draft',
      snapshot: { flow, nodes: nodes ?? [] },
      created_by: input.userId ?? null,
    })
  }

  return {
    flow: (flow ?? null) as Record<string, unknown> | null,
    nodes: (nodes ?? []) as Array<Record<string, unknown>>,
  }
}

/**
 * Dónde queda cada paso en el lienzo después de los patches.
 *
 * Se calcula aparte porque la simulación del grafo no lleva posiciones. Un paso
 * agregado sin coordenadas se pone a la derecha del último, corriendo el borde a
 * cada uno: dos pasos nuevos en el mismo turno no pueden caer en el mismo punto.
 */
function posicionesTrasPatches(
  actuales: Required<NodoGuardable>[],
  patches: AiPatch[],
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  for (const n of actuales) pos.set(n.node_key, { x: n.position_x, y: n.position_y })
  let bordeX = actuales.reduce((max, n) => Math.max(max, n.position_x), 0)

  for (const p of patches) {
    switch (p.kind) {
      case 'add_node': {
        // Mismo criterio que la simulación: un `add_node` con una clave que ya
        // existe no hace nada, así que tampoco mueve nada.
        if (pos.has(p.node_key)) break
        if (p.position) {
          pos.set(p.node_key, { x: p.position.x, y: p.position.y })
          bordeX = Math.max(bordeX, p.position.x)
        } else {
          bordeX += ANCHO_PASO
          pos.set(p.node_key, { x: bordeX, y: 0 })
        }
        break
      }
      case 'move_node':
        if (pos.has(p.node_key)) pos.set(p.node_key, { x: p.position.x, y: p.position.y })
        break
      case 'remove_node':
        pos.delete(p.node_key)
        break
      default:
        break
    }
  }
  return pos
}

export interface ResultadoPatches {
  flujo: { id: string; nombre: string; estado: EstadoFlujo }
  nodos: Array<{ node_key: string; node_type: string; config: Record<string, unknown> }>
  /** Cómo quedó el disparador y por dónde empieza, que un patch puede mover. */
  disparador: { tipo: string; config: Record<string, unknown> }
  inicio: string | null
  /** Cuántos patches se aplicaron. */
  aplicados: number
}

/**
 * Aplica cambios a un menú: simula, revalida y recién ahí escribe.
 *
 * Tres puertas, en este orden:
 *
 *  1. Cada patch tiene que estar bien formado. Descartar en silencio los que no
 *     —como hace `/assist`, que sólo propone— acá sería peor: el que pidió el
 *     cambio se quedaría creyendo que se hizo algo que nunca ocurrió.
 *  2. Los cambios no pueden introducir errores que antes no estaban. Los
 *     errores viejos no bloquean: un borrador a medio armar tiene que poder
 *     seguir editándose.
 *  3. Si el menú está ACTIVO, además tiene que quedar entero. Está atendiendo
 *     clientes ahora mismo, y ahí no alcanza con "no lo empeoré": un menú
 *     publicado con un botón colgado deja conversaciones a medias.
 */
export async function aplicarPatches(
  db: SupabaseClient,
  input: {
    flowId: string
    workspaceId: string
    patches: readonly unknown[]
    userId?: string | null
    locale?: 'es' | 'en'
  },
): Promise<ResultadoPatches> {
  const crudos = Array.isArray(input.patches) ? input.patches : []
  const patches = crudos.filter(isPatch)
  if (patches.length !== crudos.length) {
    throw new Error(
      `${crudos.length - patches.length} cambio(s) venían incompletos o con un tipo de paso que no existe. No se guardó nada.`,
    )
  }
  if (patches.length === 0) throw new Error('no hay ningún cambio que aplicar')

  const actual = await leerFlujo(db, input.flowId, input.workspaceId)
  if (!actual) throw new Error('ese menú no existe en esta cuenta')
  const { flow, nodos } = actual

  const antes: FlowSnapshot = {
    name: flow.name,
    trigger_type: flow.trigger_type,
    trigger_config: flow.trigger_config ?? {},
    entry_node_id: flow.entry_node_id,
    nodes: nodos.map((n) => ({
      node_key: n.node_key,
      node_type: n.node_type,
      config: n.config,
    })),
  }

  const nuevos = validatePatchedSnapshot(antes, patches, input.locale)
  if (nuevos.length > 0) {
    throw new Error(
      `estos cambios romperían el menú: ${nuevos.map((i) => i.message).join(' ')}`,
    )
  }

  const despues = simulateApplyPatches(antes, patches)

  if (flow.status === 'active') {
    const errores = validateFlowForActivation(
      {
        name: despues.name ?? flow.name,
        trigger_type: despues.trigger_type,
        trigger_config: despues.trigger_config,
        entry_node_id: despues.entry_node_id,
      },
      despues.nodes,
      input.locale,
    ).filter((i) => i.severity === 'error')
    if (errores.length > 0) {
      throw new Error(
        `«${flow.name}» está activo y estos cambios lo dejarían incompleto: ${errores
          .map((i) => i.message)
          .join(' ')} Pausalo antes de seguir editando.`,
      )
    }
  }

  const pos = posicionesTrasPatches(nodos, patches)
  await guardarGrafo(db, {
    flowId: flow.id,
    workspaceId: input.workspaceId,
    campos: {
      trigger_type: despues.trigger_type,
      trigger_config: despues.trigger_config,
      entry_node_id: despues.entry_node_id,
    },
    nodos: despues.nodes.map((n) => ({
      node_key: n.node_key,
      node_type: n.node_type,
      config: n.config,
      position_x: pos.get(n.node_key)?.x ?? 0,
      position_y: pos.get(n.node_key)?.y ?? 0,
    })),
    userId: input.userId ?? null,
    locale: input.locale,
  })

  return {
    flujo: { id: flow.id, nombre: flow.name, estado: flow.status },
    nodos: despues.nodes.map((n) => ({
      node_key: n.node_key,
      node_type: n.node_type,
      config: n.config,
    })),
    disparador: { tipo: despues.trigger_type, config: despues.trigger_config },
    inicio: despues.entry_node_id,
    aplicados: patches.length,
  }
}

export type ResultadoEstado =
  | { ok: true; flow: Record<string, unknown> | null }
  /** No se activó: el validador encontró errores que hay que resolver antes. */
  | { ok: false; issues: ValidationIssue[] }

/**
 * Prende, pausa o archiva un menú.
 *
 * Activar corre el validador completo y se niega ante cualquier error. Pasar a
 * borrador o archivar es incondicional: hay que poder pausar algo roto sin
 * arreglarlo primero, que es justo lo que se necesita cuando está fallando.
 */
export async function cambiarEstado(
  db: SupabaseClient,
  input: {
    flowId: string
    workspaceId: string
    estado: EstadoFlujo
    userId?: string | null
    locale?: "es" | "en"
    /** Queda en el historial de versiones publicadas. */
    nota?: string
  },
): Promise<ResultadoEstado> {
  const actual = await leerFlujo(db, input.flowId, input.workspaceId)
  if (!actual) throw new Error('ese menú no existe en esta cuenta')
  const { flow, nodos } = actual

  if (input.estado === 'active') {
    const issues = validateFlowForActivation(
      {
        name: flow.name,
        trigger_type: flow.trigger_type,
        trigger_config: flow.trigger_config ?? {},
        entry_node_id: flow.entry_node_id,
      },
      nodos.map((n) => ({
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
      })),
      input.locale,
    )
    if (!issues.some((i) => i.severity === 'error')) issues.push(...await httpFlowActivationIssues(db, {
      workspaceId: input.workspaceId, flowId: flow.id, actorId: input.userId, nodes: nodos, locale: input.locale,
    }))
    if (issues.some((i) => i.severity === 'error')) return { ok: false, issues }
  }

  const { data: updated, error } = await db
    .from('flows')
    .update({ status: input.estado, updated_at: new Date().toISOString() })
    .eq('id', flow.id)
    .eq('workspace_id', input.workspaceId)
    .select()
    .maybeSingle()
  if (error) throw new Error(error.message)

  // Al activar se guarda el estado exacto que queda corriendo. Es la versión
  // contra la que se compara cuando algo empieza a fallar en producción.
  if (input.estado === 'active') {
    const [{ data: flowRow }, { data: nodesRow }] = await Promise.all([
      db.from('flows').select('*').eq('id', flow.id).maybeSingle(),
      db.from('flow_nodes').select('*').eq('flow_id', flow.id),
    ])
    if (flowRow) {
      await db.from('flow_versions').insert({
        flow_id: flow.id,
        kind: 'published',
        snapshot: { flow: flowRow, nodes: nodesRow ?? [] },
        created_by: input.userId ?? null,
        note: input.nota ?? 'Publicado desde el editor',
      })
    }
  }

  return { ok: true, flow: (updated ?? null) as Record<string, unknown> | null }
}
