import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { getTemplate } from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'

// ------------------------------------------------------------
// Install an automation from a pre-built template in one POST.
//
// The /automatizaciones gallery cards hit this endpoint when the user
// clicks "Usar plantilla": we create the automation row + its step
// tree, return the new automation id, and the UI redirects the user
// straight to the editor where they fill in the template_name / tag_id
// placeholders before activating.
//
// All automations land as is_active=false on purpose — activation
// would fail the validate.ts gate anyway since the template seeds
// leave template_name and tag_id empty.
// ------------------------------------------------------------

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as
    | { template_id?: string }
    | null
  const templateId = body?.template_id
  if (!templateId) {
    return NextResponse.json({ error: 'template_id is required' }, { status: 400 })
  }

  const template = getTemplate(templateId)
  if (!template) {
    return NextResponse.json({ error: 'Unknown template' }, { status: 404 })
  }

  const admin = supabaseAdmin()
  const { data: automation, error: insertErr } = await admin
    .from('automations')
    .insert({
      user_id: user.id,
      name: template.name,
      description: template.description,
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
      return NextResponse.json({ error: err }, { status: 500 })
    }
  }

  return NextResponse.json({ automation }, { status: 201 })
}
