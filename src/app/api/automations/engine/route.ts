import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import type { AutomationTriggerType } from '@/types'
import { resolveWorkspaceIdForUser, isMemberOfLiveWorkspace } from '@/lib/workspaces/resolve'

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
  const locale = await getLocale()

  const body = await request.json().catch(() => null)
  if (!body?.trigger_type) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.automationTriggerTypeRequired') },
      { status: 400 },
    )
  }

  const admin = supabaseAdmin()
  let resolvedWorkspaceId: string | null =
    (body.workspace_id as string | undefined) ?? null
  if (resolvedWorkspaceId) {
    // Un workspace borrado ya no es un destino válido: la membresía
    // sobrevive al borrado, así que preguntarla sola lo aceptaría.
    const member = await isMemberOfLiveWorkspace(admin, user.id, resolvedWorkspaceId)
    if (!member) {
      return NextResponse.json(
        { error: translate(locale, 'errFlows.notWorkspaceMember') },
        { status: 403 },
      )
    }
  } else {
    // Descarta los workspaces borrados: sin eso, una cuenta que se unió
    // primero a uno que después borró dispara siempre contra ese, donde no
    // hay ninguna automatización, y la llamada contesta "ok" sin hacer nada.
    resolvedWorkspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  }
  if (!resolvedWorkspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.noWorkspace') },
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
