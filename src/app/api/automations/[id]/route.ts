import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/**
 * Resolve the automation's workspace and confirm the caller belongs
 * to it. Mirrors the pattern in src/app/api/messages/[id]/route.ts.
 * We cannot rely on PostgREST + RLS alone here because we use the
 * service-role admin client (RLS is bypassed), and we cannot scope by
 * user_id because workspace teammates are valid editors.
 *
 * Returns the loaded automation row on success, or a Response to
 * return directly on auth/404 failure.
 */
async function loadAuthorizedAutomation(
  admin: ReturnType<typeof supabaseAdmin>,
  automationId: string,
  userId: string,
  // Caller-supplied projection — keeps PATCH's "need is_active +
  // trigger_* for re-validation" path from doing a second round trip.
  columns: string = 'id, user_id, workspace_id',
): Promise<
  | { ok: true; automation: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const { data: existing } = await admin
    .from('automations')
    .select(columns)
    .eq('id', automationId)
    .maybeSingle()
  if (!existing) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }
  const workspaceId = (existing as { workspace_id?: string }).workspace_id
  if (!workspaceId) {
    // Pre-013 rows that never got backfilled. Treat as not-found to
    // avoid leaking the row's existence to non-owners.
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }
  const { data: membership } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }
  return {
    ok: true,
    automation: existing as unknown as Record<string, unknown>,
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const loaded = await loadAuthorizedAutomation(admin, id, user.id, '*')
  if (!loaded.ok) return loaded.response

  const steps = await loadStepsTree(id)
  return NextResponse.json({ automation: loaded.automation, steps })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block
  const { id } = await params
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()

  // Workspace-membership gate (replaces the old user_id ownership
  // check). Loads the fields needed for post-patch validation in the
  // same round trip.
  const loaded = await loadAuthorizedAutomation(
    admin,
    id,
    user.id,
    'id, user_id, workspace_id, is_active, trigger_type, trigger_config',
  )
  if (!loaded.ok) return loaded.response
  const existing = loaded.automation as {
    is_active: boolean
    trigger_type: string
    trigger_config: unknown
  }

  const update: Record<string, unknown> = {}
  for (const k of [
    'name',
    'description',
    'trigger_type',
    'trigger_config',
    'audience_segment_id',
    'is_active',
  ] as const) {
    if (k in body) update[k] = body[k]
  }

  // If this PATCH leaves the automation active (either explicitly
  // activating it OR editing an already-active one), validate the
  // merged configuration first. Activation is the natural gate — drafts
  // are still allowed to be incomplete.
  const willBeActive =
    typeof update.is_active === 'boolean' ? update.is_active : existing.is_active
  if (willBeActive) {
    const mergedTriggerType = (update.trigger_type ?? existing.trigger_type) as string
    const mergedTriggerConfig = update.trigger_config ?? existing.trigger_config
    const mergedSteps = Array.isArray(body.steps)
      ? (body.steps as { step_type: string; step_config: Record<string, unknown> }[])
      : await loadStepsTree(id)
    const issues = [
      ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig),
      ...validateStepsForActivation(mergedSteps),
    ]
    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot keep automation active with invalid configuration',
          issues,
        },
        { status: 400 },
      )
    }
  }

  if (Object.keys(update).length > 0) {
    const { error: updErr } = await admin
      .from('automations')
      .update(update)
      .eq('id', id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  if (Array.isArray(body.steps)) {
    const err = await replaceSteps(id, body.steps as BuilderStepInput[])
    if (err) return NextResponse.json({ error: err }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block
  const { id } = await params
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  // Must include workspace_id: loadAuthorizedAutomation reads it to run
  // the membership check. Selecting only 'id' left workspace_id undefined
  // and made every delete 404 with "Not found".
  const loaded = await loadAuthorizedAutomation(admin, id, user.id, 'id, workspace_id')
  if (!loaded.ok) return loaded.response

  // Soft-delete via migration 059's `deleted_at` column — preserves
  // historical automation_logs analytics. Partial index
  // `idx_automations_trigger_active` ignores tombstones, so a deleted
  // automation stops consuming inbound triggers immediately.
  const { error } = await admin
    .from('automations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
