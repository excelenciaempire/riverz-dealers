import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import {
  getTemplate,
  automationTemplateNameKey,
  automationTemplateDescKey,
} from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import { resolverEtiquetas } from '@/lib/automations/resolve-tag-seeds'
import { armAutomation } from '@/lib/automations/activation'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { resolveWorkspaceIdForUser, isMemberOfLiveWorkspace } from '@/lib/workspaces/resolve'
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
  const locale = await getLocale()

  // Scope by workspace_id so a multi-workspace user doesn't see a
  // cross-tenant mix. RLS protects against access, but it cannot
  // disambiguate which workspace the UI is currently scoped to.
  const admin = supabaseAdmin()
  const url = new URL(request.url)
  let resolvedWorkspaceId: string | null =
    url.searchParams.get('workspace_id') ?? null
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
    const member = {
      // Descarta los workspaces borrados. Sin eso, una cuenta que se
      // unió primero a uno que después borró escribe siempre ahí: la
      // fila se guarda y no aparece en ninguna pantalla.
      workspace_id: await resolveWorkspaceIdForUser(admin, user.id),
    }
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
  if (error) return serverError(error)
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
  const locale = await getLocale()

  const body = await request.json().catch(() => null)
  if (!body)
    return NextResponse.json(
      { error: translate(locale, 'errFlows.invalidJson') },
      { status: 400 },
    )

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
    const t = getTemplate(template, locale)
    if (t) {
      effectiveName =
        effectiveName ?? translate(locale, automationTemplateNameKey(t.slug))
      effectiveDescription =
        effectiveDescription ?? translate(locale, automationTemplateDescKey(t.slug))
      effectiveTriggerType = effectiveTriggerType ?? t.trigger_type
      effectiveTriggerConfig = effectiveTriggerConfig ?? t.trigger_config
      effectiveSteps = t.steps as unknown as BuilderStepInput[]
    }
  }

  if (!effectiveName || !effectiveTriggerType) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.automationNameAndTriggerRequired') },
      { status: 400 },
    )
  }

  const admin = supabaseAdmin()

  // Resolve the workspace this automation belongs to. The engine
  // dispatcher selects automations by workspace_id — leaving the column
  // NULL would make the row invisible to every runAutomationsForTrigger
  // call. Body wins (workspace switcher), then primary workspace_members.
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
    // Acá se ESCRIBE, así que el workspace equivocado no se nota: la
    // automatización se guarda, no aparece en ninguna pantalla y no la
    // dispara nadie. Es lo que enterró dos flujos y una automatización en
    // esta misma cuenta.
    resolvedWorkspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  }
  if (!resolvedWorkspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.noWorkspace') },
      { status: 400 },
    )
  }

  const resolvedSteps = await resolverEtiquetas(
    admin,
    resolvedWorkspaceId,
    effectiveSteps ?? [],
  )
  const issues = [
    ...validateTriggerForActivation(effectiveTriggerType, effectiveTriggerConfig),
    ...validateStepsForActivation(resolvedSteps),
  ]
  if (issues.length > 0) {
    return NextResponse.json(
      { error: translate(locale, 'automations.saveFailed'), issues },
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
      // Se crea apagada primero. Las dependencias que necesitan consultar Meta
      // sólo existen después de insertar sus pasos.
      is_active: false,
      activation_state: is_active ? 'armed' : 'draft',
    })
    .select()
    .single()

  if (insertErr || !automation) {
    return serverError(insertErr)
  }

  if (resolvedSteps.length > 0) {
    const err = await insertSteps(automation.id, resolvedSteps)
    if (err) return serverError(err)
  }

  if (is_active) {
    const readiness = await armAutomation(admin, automation.id, resolvedWorkspaceId)
    return NextResponse.json({
      automation: {
        ...automation,
        activation_state: readiness.state,
        activation_blockers: readiness.issues,
        is_active: readiness.state === 'active',
      },
    }, { status: 201 })
  }

  return NextResponse.json({ automation }, { status: 201 })
}
