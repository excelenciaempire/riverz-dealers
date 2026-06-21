import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { validateFlowForActivation } from '@/lib/flows/validate'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * POST /api/flows/[id]/activate
 *
 * Body: { status: 'draft' | 'active' | 'archived' }
 *
 * Activating runs the full validator and refuses on any 'error'
 * severity issue. Drafts and archives are unconditional — users
 * need to be able to save broken-work-in-progress and pause flows
 * without first fixing them.
 *
 * Returns the updated flow on success; on validation failure returns
 * the full issue list so the builder can highlight each problem.
 */

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block
  const { id } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const locale = await getLocale()

  const body = (await request.json().catch(() => null)) as
    | { status?: 'draft' | 'active' | 'archived' }
    | null
  const status = body?.status
  if (!status || !['draft', 'active', 'archived'].includes(status)) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.activateInvalidStatus') },
      { status: 400 },
    )
  }

  // Ownership via RLS — caller's client.
  const { data: existing } = await supabase
    .from('flows')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.notFound') },
      { status: 404 },
    )
  }

  const admin = supabaseAdmin()

  if (status === 'active') {
    // Re-load with the full payload the validator needs.
    const [{ data: flow }, { data: nodes }] = await Promise.all([
      admin
        .from('flows')
        .select('name, trigger_type, trigger_config, entry_node_id')
        .eq('id', id)
        .maybeSingle(),
      admin
        .from('flow_nodes')
        .select('node_key, node_type, config')
        .eq('flow_id', id),
    ])
    if (!flow) {
      return NextResponse.json(
        { error: translate(locale, 'errFlows.notFound') },
        { status: 404 },
      )
    }
    const issues = validateFlowForActivation(
      flow as {
        name: string
        trigger_type: 'keyword' | 'first_inbound_message' | 'manual'
        trigger_config: Record<string, unknown>
        entry_node_id: string | null
      },
      (nodes ?? []) as Array<{
        node_key: string
        node_type: string
        config: Record<string, unknown>
      }>,
    )
    const blockers = issues.filter((i) => i.severity === 'error')
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: translate(locale, 'errFlows.activateHasBlockers'),
          issues,
        },
        { status: 422 },
      )
    }
  }

  const { data: updated, error } = await admin
    .from('flows')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) {
    return serverError(error)
  }
  // Cuando se ACTIVA por primera vez o se reactiva tras cambios,
  // snapshot del estado actual como `published`. Es la versión que
  // realmente está corriendo en producción.
  if (status === 'active') {
    const [{ data: flowRow }, { data: nodesRow }] = await Promise.all([
      admin.from('flows').select('*').eq('id', id).maybeSingle(),
      admin.from('flow_nodes').select('*').eq('flow_id', id),
    ])
    if (flowRow) {
      await admin.from('flow_versions').insert({
        flow_id: id,
        kind: 'published',
        snapshot: { flow: flowRow, nodes: nodesRow ?? [] },
        created_by: user.id,
        note: 'Publicado desde el editor',
      })
    }
  }
  return NextResponse.json({ flow: updated })
}
