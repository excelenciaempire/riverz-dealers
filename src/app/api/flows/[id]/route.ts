import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { guardarGrafo } from '@/lib/flows/write'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { idColumn } from '@/lib/short-id'

/**
 * GET   /api/flows/[id]  — fetch one flow with its nodes.
 * PUT   /api/flows/[id]  — replace name/trigger/entry/fallback + the
 *                          full node graph (delete-then-insert under
 *                          the hood; not atomic, but the runner is
 *                          resilient to mid-edit reads — node_not_found
 *                          gracefully ends the run).
 * DELETE /api/flows/[id] — hard delete (RLS+CASCADE clean up nodes,
 *                          runs, events).
 *
 * All three require a signed-in caller who owns the flow. Flows is in
 * soft-GA — the beta gate that previously 404'd non-beta accounts is
 * gone; the "Beta" label in the UI is the only remaining signal.
 */

async function requireOwnership(
  flowId: string,
): Promise<
  | {
      ok: true
      userId: string
      /** UUID completo resuelto (el param puede venir como short id de 8). */
      id: string
      /** La cuenta dueña del flujo: toda escritura se recorta por ella. */
      workspaceId: string
      supabase: Awaited<ReturnType<typeof createClient>>
    }
  | { ok: false; status: number; body: { error: string } }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } }
  }
  // RLS scopes this to the caller — a flow owned by another user
  // returns null (404 below). Resuelve short id (8) o UUID completo.
  const { data: flow } = await supabase
    .from('flows')
    .select('id, workspace_id')
    .eq(idColumn(flowId), flowId)
    .maybeSingle()
  if (!flow) {
    return { ok: false, status: 404, body: { error: 'Not found' } }
  }
  const fila = flow as { id: string; workspace_id: string }
  return {
    ok: true,
    userId: user.id,
    id: fila.id,
    workspaceId: fila.workspace_id,
    supabase,
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params
  const guard = await requireOwnership(rawId)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const { supabase, id } = guard

  const [{ data: flow }, { data: nodes }] = await Promise.all([
    supabase.from('flows').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('flow_nodes')
      .select('*')
      .eq('flow_id', id)
      .order('created_at', { ascending: true }),
  ])
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ flow, nodes: nodes ?? [] })
}

interface PutBody {
  name?: string
  description?: string | null
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
  trigger_config?: Record<string, unknown>
  entry_node_id?: string | null
  fallback_policy?: Record<string, unknown>
  /** Posición del disparador en el lienzo (migration 028). */
  trigger_position_x?: number
  trigger_position_y?: number
  nodes?: Array<{
    node_key: string
    node_type: string
    config: Record<string, unknown>
    position_x?: number
    position_y?: number
  }>
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block
  const { id: rawId } = await context.params
  const guard = await requireOwnership(rawId)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const id = guard.id
  const locale = await getLocale()

  const body = (await request.json().catch(() => null)) as PutBody | null
  if (!body) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.invalidJson') },
      { status: 400 },
    )
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.flowNameEmpty') },
      { status: 400 },
    )
  }

  // El body puede no traer `nodes` (un guardado sólo del encabezado, para
  // editar el disparador sin tocar el grafo). `guardarGrafo` lo distingue.
  const flowPatch: Record<string, unknown> = {}
  if (body.name !== undefined) flowPatch.name = body.name.trim()
  if (body.description !== undefined)
    flowPatch.description = body.description
  if (body.trigger_type !== undefined) flowPatch.trigger_type = body.trigger_type
  if (body.trigger_config !== undefined)
    flowPatch.trigger_config = body.trigger_config
  if (body.entry_node_id !== undefined)
    flowPatch.entry_node_id = body.entry_node_id
  if (body.fallback_policy !== undefined)
    flowPatch.fallback_policy = body.fallback_policy
  if (body.trigger_position_x !== undefined)
    flowPatch.trigger_position_x = body.trigger_position_x
  if (body.trigger_position_y !== undefined)
    flowPatch.trigger_position_y = body.trigger_position_y

  // La escritura (reemplazo del grafo + snapshot del borrador) vive en
  // `@/lib/flows/write` porque el chat agéntico guarda por el mismo camino: dos
  // implementaciones del mismo guardado terminan divergiendo.
  try {
    const { flow, nodes } = await guardarGrafo(supabaseAdmin(), {
      flowId: id,
      workspaceId: guard.workspaceId,
      campos: flowPatch,
      nodos: body.nodes,
      userId: guard.userId,
    })
    // Re-fetch and return the new state — the editor uses the response
    // to reconcile its local form state.
    return NextResponse.json({ flow, nodes })
  } catch (err) {
    return serverError(err)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block
  const { id: rawId } = await context.params
  const guard = await requireOwnership(rawId)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const id = guard.id

  // Soft-delete via migration 059's `deleted_at` column. The CASCADE
  // on flow_runs / flow_run_events does NOT fire because the row stays
  // in the table, which preserves historical analytics. List/get
  // endpoints filter `deleted_at IS NULL`; the runner's hot-path
  // partial index `idx_flows_active_trigger` was tightened to ignore
  // tombstones so a soft-deleted flow stops consuming inbound messages
  // immediately. Hard purge is an operator script, not a UI action.
  const { error } = await supabaseAdmin()
    .from('flows')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) {
    return serverError(error)
  }
  return NextResponse.json({ ok: true })
}

