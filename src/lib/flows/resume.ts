import { supabaseAdmin } from './admin-client'
import type { FlowNodeRow, FlowRunRow } from './types'

/**
 * Resume a parked flow run from the cron worker (called when a
 * `wait` node's run_at falls due). Loads the run, sets its current
 * node to the parked `next_node_key`, and re-enters the engine's
 * advance loop from there.
 *
 * Kept in its own module so the cron route stays slim and the
 * runner's main file doesn't pick up cron-only dependencies.
 */
export async function resumeFlowRun(args: {
  flowRunId: string
  nextNodeKey: string
}): Promise<void> {
  const db = supabaseAdmin()

  const { data: run } = await db
    .from('flow_runs')
    .select('*')
    .eq('id', args.flowRunId)
    .maybeSingle()
  if (!run) throw new Error('flow run not found')
  const r = run as FlowRunRow
  if (r.status !== 'active') return // already advanced / handed off / completed

  // Hand off to the engine's existing advance loop. We re-import here
  // (rather than at top-level) to avoid a circular dependency between
  // the cron route and the engine module.
  const { advanceParkedRun } = await import('./engine-internal')

  // Si el run quedó pausado dentro de un subflujo, los nodos del flujo
  // raíz no contienen el current_node_key — cargamos los del subflujo
  // activo (top del call_stack).
  const callStack = Array.isArray(r.call_stack) ? r.call_stack : []
  const activeFlowId =
    callStack.length > 0 ? callStack[callStack.length - 1].flow_id : r.flow_id
  const { data: nodeRows } = await db
    .from('flow_nodes')
    .select('*')
    .eq('flow_id', activeFlowId)
  const nodes = new Map<string, FlowNodeRow>()
  for (const n of (nodeRows ?? []) as FlowNodeRow[]) nodes.set(n.node_key, n)

  await advanceParkedRun(r, args.nextNodeKey, nodes)
}
