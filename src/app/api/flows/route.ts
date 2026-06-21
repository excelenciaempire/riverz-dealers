import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { csrfGuard } from '@/lib/csrf'
import {
  getFlowTemplate,
  flowTemplateNameKey,
  flowTemplateDescKey,
} from '@/lib/flows/templates'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * GET /api/flows — list the caller's flows.
 * POST /api/flows — create a new (draft) flow.
 *
 * Available to every authenticated user. The previous per-account
 * beta gate was removed when Flows went to soft-GA; the UI still
 * shows a "Beta" label so users know the surface is young, but the
 * routes themselves are open.
 */

async function requireUser(): Promise<
  | { ok: true; userId: string; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; status: number; body: { error: string } }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } }
  }
  return { ok: true, userId: user.id, supabase }
}

export async function GET() {
  const guard = await requireUser()
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status })
  }
  const { supabase } = guard

  const { data, error } = await supabase
    .from('flows')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) {
    return serverError(error)
  }
  return NextResponse.json({ flows: data ?? [] })
}

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const guard = await requireUser()
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status })
  }
  const { userId } = guard
  const locale = await getLocale()

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string
        description?: string | null
        trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
        trigger_config?: Record<string, unknown>
        /**
         * If set, clone the matching template's name + trigger +
         * entry_node_id + nodes[] into a fresh draft for this user.
         * `name` from the body overrides the template default if
         * provided.
         */
        template_slug?: string
      }
    | null
  if (!body) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.invalidJson') },
      { status: 400 },
    )
  }

  const admin = supabaseAdmin()

  // Resolve the user's primary workspace — flows.workspace_id is NOT
  // NULL per migration 013's RLS policy (`is_workspace_member(...)`),
  // and the previous insert was leaving it null which made every
  // freshly-created flow invisible to the auth-scoped GET that
  // /flows/[id] uses (→ "Flujo no encontrado").
  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const workspaceId = (membership as { workspace_id?: string } | null)?.workspace_id
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.flowNoWorkspaceAssigned') },
      { status: 500 },
    )
  }

  // -------- Template clone path --------
  if (body.template_slug) {
    const template = getFlowTemplate(body.template_slug, locale)
    if (!template) {
      return NextResponse.json(
        {
          error: translate(locale, 'errFlows.flowUnknownTemplate', {
            slug: body.template_slug,
          }),
        },
        { status: 400 },
      )
    }
    const { data: flow, error: flowErr } = await admin
      .from('flows')
      .insert({
        user_id: userId,
        workspace_id: workspaceId,
        name:
          body.name?.trim() ||
          translate(locale, flowTemplateNameKey(template.slug)),
        description: translate(locale, flowTemplateDescKey(template.slug)),
        status: 'draft',
        trigger_type: template.trigger_type,
        trigger_config: template.trigger_config,
        entry_node_id: template.entry_node_id,
      })
      .select()
      .single()
    if (flowErr || !flow) {
      return serverError(flowErr)
    }
    if (template.nodes.length > 0) {
      const { error: nodesErr } = await admin.from('flow_nodes').insert(
        template.nodes.map((n) => ({
          flow_id: flow.id,
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config,
        })),
      )
      if (nodesErr) {
        // Roll back the parent flow so a half-cloned template doesn't
        // sit as an empty draft. CASCADE on flow_id removes the
        // (probably zero) nodes too.
        await admin.from('flows').delete().eq('id', flow.id)
        return serverError(nodesErr)
      }
    }
    return NextResponse.json({ flow }, { status: 201 })
  }

  // -------- Plain (empty) create path --------
  if (!body.name?.trim()) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.flowNameRequired') },
      { status: 400 },
    )
  }
  // Default to first_inbound_message: it has no required config, so the
  // editor opens without a red "missing keywords" error blocking the
  // brand-new draft. Users who actually want keyword routing change it
  // from the trigger card on the canvas.
  const trigger_type = body.trigger_type ?? 'first_inbound_message'

  const { data, error } = await admin
    .from('flows')
    .insert({
      user_id: userId,
      workspace_id: workspaceId,
      name: body.name.trim(),
      description: body.description ?? null,
      status: 'draft',
      trigger_type,
      trigger_config: body.trigger_config ?? {},
    })
    .select()
    .single()
  if (error || !data) {
    return serverError(error)
  }
  return NextResponse.json({ flow: data }, { status: 201 })
}
