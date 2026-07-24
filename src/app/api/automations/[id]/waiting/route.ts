import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * Live "who is waiting where" for a saved automation's wait steps.
 *
 * `automation_pending_executions` is service-role only (no browser RLS), so the
 * count is computed here with the admin client after a workspace-membership
 * gate. Each pending row a wait step created is tagged with the SCOPE it paused
 * in — (parent_step_id, branch, next_step_position) — where
 * next_step_position = wait.position + 1. So a pending row maps back to exactly
 * the wait at (parent_step_id, branch, next_step_position - 1). We return counts
 * keyed by that wait step's id, which the builder holds on each loaded node
 * (BuilderStep.serverId).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()

  // Workspace-membership gate (same shape as GET /api/automations/[id]).
  const { data: automation } = await admin
    .from('automations')
    .select('id, workspace_id')
    .eq('id', id)
    .maybeSingle()
  const workspaceId = (automation as { workspace_id?: string } | null)?.workspace_id
  if (!workspaceId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { data: membership } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: steps, error: stepsErr } = await admin
    .from('automation_steps')
    .select('id, parent_step_id, branch, position, step_type')
    .eq('automation_id', id)
  if (stepsErr) return serverError(stepsErr)

  const waitSteps = (
    (steps ?? []) as {
      id: string
      parent_step_id: string | null
      branch: 'yes' | 'no' | null
      position: number
      step_type: string
    }[]
  ).filter((s) => s.step_type === 'wait')
  if (waitSteps.length === 0) {
    return NextResponse.json({ counts: {}, total: 0 })
  }

  const { data: pending, error: pendingErr } = await admin
    .from('automation_pending_executions')
    .select('parent_step_id, branch, next_step_position')
    .eq('automation_id', id)
    .eq('status', 'pending')
  if (pendingErr) return serverError(pendingErr)

  // Group pending rows by the scope key they resume into.
  const key = (
    parent: string | null,
    branch: string | null,
    pos: number,
  ) => `${parent ?? 'root'}|${branch ?? ''}|${pos}`

  const pendingByKey = new Map<string, number>()
  for (const p of (pending ?? []) as {
    parent_step_id: string | null
    branch: 'yes' | 'no' | null
    next_step_position: number
  }[]) {
    const k = key(p.parent_step_id, p.branch, p.next_step_position)
    pendingByKey.set(k, (pendingByKey.get(k) ?? 0) + 1)
  }

  const counts: Record<string, number> = {}
  let total = 0
  for (const w of waitSteps) {
    const n = pendingByKey.get(key(w.parent_step_id, w.branch, w.position + 1)) ?? 0
    if (n > 0) {
      counts[w.id] = n
      total += n
    }
  }

  return NextResponse.json({ counts, total })
}
