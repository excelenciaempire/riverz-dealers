import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { resolveShortId } from '@/lib/short-id'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import { resolverEtiquetas } from '@/lib/automations/resolve-tag-seeds'
import { armAutomation } from '@/lib/automations/activation'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import type { Locale } from '@/lib/i18n/config'
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
  locale: Locale,
  // Caller-supplied projection — keeps PATCH's "need is_active +
  // trigger_* for re-validation" path from doing a second round trip.
  columns: string = 'id, user_id, workspace_id',
): Promise<
  | { ok: true; automation: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const notFound = () =>
    NextResponse.json(
      { error: translate(locale, 'errFlows.notFound') },
      { status: 404 },
    )
  const { data: existing } = await admin
    .from('automations')
    .select(columns)
    .eq('id', automationId)
    .maybeSingle()
  if (!existing) {
    return { ok: false, response: notFound() }
  }
  const workspaceId = (existing as { workspace_id?: string }).workspace_id
  if (!workspaceId) {
    // Pre-013 rows that never got backfilled. Treat as not-found to
    // avoid leaking the row's existence to non-owners.
    return { ok: false, response: notFound() }
  }
  const { data: membership } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) {
    return { ok: false, response: notFound() }
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
  const { id: rawId } = await params
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const locale = await getLocale()

  const admin = supabaseAdmin()
  const id = await resolveShortId(admin, 'automations', rawId)
  const loaded = await loadAuthorizedAutomation(admin, id, user.id, locale, '*')
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
  const { id: rawId } = await params
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const locale = await getLocale()

  const body = await request.json().catch(() => null)
  if (!body)
    return NextResponse.json(
      { error: translate(locale, 'errFlows.invalidJson') },
      { status: 400 },
    )

  const admin = supabaseAdmin()
  const id = await resolveShortId(admin, 'automations', rawId)

  // Workspace-membership gate (replaces the old user_id ownership
  // check). Loads the fields needed for post-patch validation in the
  // same round trip.
  const loaded = await loadAuthorizedAutomation(
    admin,
    id,
    user.id,
    locale,
    'id, user_id, workspace_id, is_active, activation_state, trigger_type, trigger_config',
  )
  if (!loaded.ok) return loaded.response
  const existing = loaded.automation as {
    is_active: boolean
    activation_state?: 'draft' | 'armed' | 'active'
    trigger_type: string
    trigger_config: unknown
    workspace_id: string
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

  const requestedState = existing.activation_state ?? (existing.is_active ? 'active' : 'draft')
  const shouldRemainRequested =
    update.is_active === true ||
    (update.is_active !== false && (requestedState === 'armed' || requestedState === 'active'))

  const editsDefinition =
    Array.isArray(body.steps) ||
    'trigger_type' in body ||
    'trigger_config' in body
  const resolvedSteps = Array.isArray(body.steps)
    ? await resolverEtiquetas(
        admin,
        existing.workspace_id,
        body.steps as BuilderStepInput[],
      )
    : null

  // Una definición incompleta no se persiste ni siquiera como borrador. La
  // API aplica la misma barrera que el editor. Desactivar siempre se permite.
  if (editsDefinition || update.is_active === true) {
    const stepsToValidate = resolvedSteps ?? (await loadStepsTree(id))
    const issues = [
      ...validateTriggerForActivation(
        String(update.trigger_type ?? existing.trigger_type),
        update.trigger_config ?? existing.trigger_config,
      ),
      ...validateStepsForActivation(stepsToValidate),
    ]
    if (issues.length > 0) {
      return NextResponse.json(
        { error: translate(locale, 'automations.saveFailed'), issues },
        { status: 400 },
      )
    }
  }

  // Desactiva el motor antes de cambiar un flujo ya solicitado. Así ni siquiera
  // una carrera breve puede ejecutar pasos con una plantilla recién cambiada.
  if (shouldRemainRequested) update.is_active = false
  if (update.is_active === false) {
    update.activation_state = 'draft'
    update.activation_blockers = []
  }

  if (Object.keys(update).length > 0) {
    const { error: updErr } = await admin
      .from('automations')
      .update(update)
      .eq('id', id)
    if (updErr) return serverError(updErr)
  }

  if (Array.isArray(body.steps)) {
    const err = await replaceSteps(id, resolvedSteps ?? [])
    if (err) return serverError(err)
  }

  if (shouldRemainRequested) {
    // Una solicitud de activación queda armada si Meta o una integración no
    // están listas. La misma función revisa plantillas, WhatsApp y Mercado
    // Pago para UI, Operador y motor.
    const readiness = await armAutomation(admin, id, existing.workspace_id)
    return NextResponse.json({
      ok: true,
      readiness: {
        activation_state: readiness.state,
        activation_blockers: readiness.issues,
        is_active: readiness.state === 'active',
      },
    })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block
  const { id: rawId } = await params
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const locale = await getLocale()

  const admin = supabaseAdmin()
  const id = await resolveShortId(admin, 'automations', rawId)
  // Must include workspace_id: loadAuthorizedAutomation reads it to run
  // the membership check. Selecting only 'id' left workspace_id undefined
  // and made every delete 404 with "Not found".
  const loaded = await loadAuthorizedAutomation(admin, id, user.id, locale, 'id, workspace_id')
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
  if (error) return serverError(error)
  return NextResponse.json({ ok: true })
}
