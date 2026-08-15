import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import {
  getTemplate,
  automationTemplateNameKey,
  automationTemplateDescKey,
  type TemplateStepSeed,
} from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import { ensureTag } from '@/lib/contacts/tags'
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
// All automations land as is_active=false on purpose — activation
// would fail the validate.ts gate anyway since the template seeds leave
// template_name empty AND the final add_tag step's tag_id empty, so the
// user fills the template + picks/creates a tag before activating.
// ------------------------------------------------------------

/**
 * Cambia los `tag_name` de la receta por ids reales de este workspace.
 *
 * `add_tag` sólo entiende `tag_id`, y una receta no puede traer el id de una
 * etiqueta que todavía no existe. Resolverlo acá —creando la etiqueta si hace
 * falta— es lo que permite que una receta llegue armada: el rescate de carrito
 * trae dos etiquetas y dejarlas vacías obligaba a inventarles nombre antes de
 * poder activar nada.
 *
 * Si la etiqueta no se puede crear, el hueco queda vacío y `validate.ts` frena
 * la activación con el mismo mensaje de siempre. Nunca se cuela un id inválido.
 */
async function resolverEtiquetas(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  steps: readonly TemplateStepSeed[],
): Promise<BuilderStepInput[]> {
  const cache = new Map<string, string>()
  const out: BuilderStepInput[] = []
  for (const s of steps) {
    const seed = s as unknown as BuilderStepInput & { tag_name?: string }
    if (s.step_type !== 'add_tag' || !s.tag_name) {
      out.push(seed)
      continue
    }
    const id = await ensureTag(admin, workspaceId, s.tag_name, { cache })
    out.push({
      ...seed,
      step_config: { ...(seed.step_config ?? {}), tag_id: id ?? '' },
    })
  }
  return out
}

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
      await resolverEtiquetas(admin, workspaceId, template.steps),
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
