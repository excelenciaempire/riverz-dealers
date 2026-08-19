import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { getTemplate } from '@/lib/automations/templates'
import { installTemplate } from '@/lib/automations/install-template'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { resolveWorkspaceIdForUser, isMemberOfLiveWorkspace } from '@/lib/workspaces/resolve'

// ------------------------------------------------------------
// Install an automation from a pre-built template in one POST.
//
// The /automatizaciones gallery cards hit this endpoint when the user
// clicks "Usar plantilla": we create the automation row + its step
// tree, return the new automation id, and the UI redirects the user
// straight to the editor where they fill in the template_name
// placeholder before activating.
//
// El trabajo real lo hace `installTemplate`; acá quedan la sesión y la
// resolución de la cuenta, que es lo único propio de HTTP. El Operator
// instala la misma receta llamando a ese servicio sin pasar por acá.
//
// All automations land as is_active=false on purpose — activation
// would fail the validate.ts gate anyway since the template seeds leave
// template_name empty AND the final add_tag step's tag_id empty, so the
// user fills the template + picks/creates a tag before activating.
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
    // Un workspace borrado ya no es un destino válido: la membresía
    // sobrevive al borrado, así que preguntarla sola lo aceptaría.
    const member = await isMemberOfLiveWorkspace(admin, user.id, workspaceId)
    if (!member) {
      return NextResponse.json(
        { error: translate(locale, 'errFlows.notWorkspaceMember') },
        { status: 403 },
      )
    }
  } else {
    const member = {
      // Descarta los workspaces borrados. Sin eso, una cuenta que se
      // unió primero a uno que después borró escribe siempre ahí: la
      // fila se guarda y no aparece en ninguna pantalla.
      workspace_id: await resolveWorkspaceIdForUser(admin, user.id),
    }
    workspaceId =
      (member as { workspace_id?: string | null } | null)?.workspace_id ?? null
  }
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.noWorkspace') },
      { status: 400 },
    )
  }

  try {
    const automation = await installTemplate(admin, {
      templateId: template.slug,
      workspaceId,
      userId: user.id,
      locale,
    })
    return NextResponse.json({ automation }, { status: 201 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'insert failed' },
      { status: 500 },
    )
  }
}
