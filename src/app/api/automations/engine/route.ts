import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import type { AutomationTriggerType } from '@/types'

/**
 * Manual trigger for testing or for external integrations that want
 * to fire automations. Auth is required, and the dispatch is scoped by
 * workspace_id (NOT auth.users.id). The caller may pass an explicit
 * `workspace_id` in the body — we verify membership; otherwise we fall
 * back to the user's primary (oldest) workspace_members row. Passing
 * `user.id` as the workspace would query
 * `automations.workspace_id = <auth.users.id>` and silently match
 * nothing, so we never do that.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body?.trigger_type) {
    return NextResponse.json({ error: 'trigger_type required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
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

  await runAutomationsForTrigger({
    workspaceId: resolvedWorkspaceId,
    triggerType: body.trigger_type as AutomationTriggerType,
    contactId: body.contact_id ?? null,
    context: body.context ?? {},
  })

  return NextResponse.json({ ok: true })
}
