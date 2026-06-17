import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { getTemplate } from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Scope by workspace_id so a multi-workspace user doesn't see a
  // cross-tenant mix. RLS protects against access, but it cannot
  // disambiguate which workspace the UI is currently scoped to.
  const admin = supabaseAdmin()
  const url = new URL(request.url)
  let resolvedWorkspaceId: string | null =
    url.searchParams.get('workspace_id') ?? null
  if (resolvedWorkspaceId) {
    const { data: member } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', resolvedWorkspaceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!member) {
      return NextResponse.json(
        { error: 'Not a member of that workspace' },
        { status: 403 },
      )
    }
  } else {
    const { data: member } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    resolvedWorkspaceId =
      (member as { workspace_id?: string | null } | null)?.workspace_id ?? null
  }
  if (!resolvedWorkspaceId) {
    return NextResponse.json({ automations: [] })
  }

  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('workspace_id', resolvedWorkspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ automations: data ?? [] })
}

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const {
    name,
    description,
    trigger_type,
    trigger_config,
    audience_segment_id,
    is_active,
    steps,
    template,
  } = body

  let effectiveSteps: BuilderStepInput[] | undefined = steps
  let effectiveName = name
  let effectiveDescription = description
  let effectiveTriggerType = trigger_type
  let effectiveTriggerConfig = trigger_config

  if (template && (!steps || steps.length === 0)) {
    const t = getTemplate(template)
    if (t) {
      effectiveName = effectiveName ?? t.name
      effectiveDescription = effectiveDescription ?? t.description
      effectiveTriggerType = effectiveTriggerType ?? t.trigger_type
      effectiveTriggerConfig = effectiveTriggerConfig ?? t.trigger_config
      effectiveSteps = t.steps as unknown as BuilderStepInput[]
    }
  }

  if (!effectiveName || !effectiveTriggerType) {
    return NextResponse.json(
      { error: 'name and trigger_type are required' },
      { status: 400 },
    )
  }

  // Block activation of a clearly broken automation up-front instead of
  // letting every trigger silently produce a failed log row. Drafts
  // (is_active=false) are allowed to be incomplete so users can save
  // progress mid-build.
  if (is_active) {
    const issues = [
      ...validateTriggerForActivation(effectiveTriggerType, effectiveTriggerConfig ?? {}),
      ...validateStepsForActivation(
        (effectiveSteps ?? []) as unknown as { step_type: string; step_config: Record<string, unknown> }[],
      ),
    ]
    if (issues.length > 0) {
      return NextResponse.json(
        { error: 'Cannot activate automation with invalid configuration', issues },
        { status: 400 },
      )
    }
  }

  const admin = supabaseAdmin()

  // Resolve the workspace this automation belongs to. The engine
  // dispatcher selects automations by workspace_id — leaving the column
  // NULL would make the row invisible to every runAutomationsForTrigger
  // call. Body wins (workspace switcher), then primary workspace_members.
  let resolvedWorkspaceId: string | null =
    (body.workspace_id as string | undefined) ?? null
  if (resolvedWorkspaceId) {
    const { data: member } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', resolvedWorkspaceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!member) {
      return NextResponse.json(
        { error: 'Not a member of that workspace' },
        { status: 403 },
      )
    }
  } else {
    const { data: member } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    resolvedWorkspaceId =
      (member as { workspace_id?: string | null } | null)?.workspace_id ?? null
  }
  if (!resolvedWorkspaceId) {
    return NextResponse.json(
      { error: 'No workspace found for user' },
      { status: 400 },
    )
  }

  const { data: automation, error: insertErr } = await admin
    .from('automations')
    .insert({
      user_id: user.id,
      workspace_id: resolvedWorkspaceId,
      name: effectiveName,
      description: effectiveDescription ?? null,
      trigger_type: effectiveTriggerType,
      trigger_config: effectiveTriggerConfig ?? {},
      audience_segment_id: audience_segment_id ?? null,
      is_active: !!is_active,
    })
    .select()
    .single()

  if (insertErr || !automation) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert failed' },
      { status: 500 },
    )
  }

  if (effectiveSteps && effectiveSteps.length > 0) {
    const err = await insertSteps(automation.id, effectiveSteps)
    if (err) return NextResponse.json({ error: err }, { status: 500 })
  }

  return NextResponse.json({ automation }, { status: 201 })
}
