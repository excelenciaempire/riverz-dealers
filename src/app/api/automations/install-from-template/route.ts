import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import {
  getTemplate,
  automationTemplateNameKey,
  automationTemplateDescKey,
} from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

// ------------------------------------------------------------
// Install an automation from a pre-built template in one POST.
//
// The /automatizaciones gallery cards hit this endpoint when the user
// clicks "Usar plantilla": we create the automation row + its step
// tree, return the new automation id, and the UI redirects the user
// straight to the editor where they fill in the template_name
// placeholder before activating.
//
// All automations land as is_active=false on purpose — activation
// would fail the validate.ts gate anyway since the template seeds
// leave template_name empty. Templates no longer seed an add_tag step,
// so there's no tag_id placeholder to fill.
// ------------------------------------------------------------

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const locale = await getLocale()

  const body = (await request.json().catch(() => null)) as
    | { template_id?: string; workspace_id?: string }
    | null
  const templateId = body?.template_id
  if (!templateId) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.automationTemplateIdRequired') },
      { status: 400 },
    )
  }

  const template = getTemplate(templateId, locale)
  if (!template) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.automationUnknownTemplate') },
      { status: 404 },
    )
  }

  const admin = supabaseAdmin()

  // Resolve the workspace this automation belongs to. The body can pin
  // a specific workspace (workspace switcher use-case); otherwise we
  // pick the user's primary workspace via workspace_members. Without
  // this, the row landed with workspace_id=NULL and silently never
  // matched any runAutomationsForTrigger(workspace_id=…) dispatch.
  let workspaceId = body?.workspace_id ?? null
  if (workspaceId) {
    const { data: member } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!member) {
      return NextResponse.json(
        { error: translate(locale, 'errFlows.notWorkspaceMember') },
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
    workspaceId =
      (member as { workspace_id?: string | null } | null)?.workspace_id ?? null
  }
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.noWorkspace') },
      { status: 400 },
    )
  }

  const { data: automation, error: insertErr } = await admin
    .from('automations')
    .insert({
      user_id: user.id,
      workspace_id: workspaceId,
      name: translate(locale, automationTemplateNameKey(template.slug)),
      description: translate(locale, automationTemplateDescKey(template.slug)),
      trigger_type: template.trigger_type,
      trigger_config: template.trigger_config ?? {},
      // Templates always land paused. The user has to fill in template
      // names + tag ids before activation passes the validate.ts gate.
      is_active: false,
    })
    .select()
    .single()

  if (insertErr || !automation) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert failed' },
      { status: 500 },
    )
  }

  if (template.steps.length > 0) {
    const err = await insertSteps(
      automation.id,
      template.steps as unknown as BuilderStepInput[],
    )
    if (err) {
      // Clean up the orphan automation row so the user doesn't end up
      // with an empty automation if the steps insert fails.
      await admin.from('automations').delete().eq('id', automation.id)
      return serverError(err)
    }
  }

  return NextResponse.json({ automation }, { status: 201 })
}
