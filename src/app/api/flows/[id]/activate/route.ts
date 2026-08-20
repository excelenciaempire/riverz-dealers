import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serverError } from '@/lib/api/errors'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { cambiarEstado } from '@/lib/flows/write'
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

  // Ownership via RLS — caller's client. Un menú borrado ya no se prende: la
  // fila sigue existiendo (borrado suave) y sin este filtro se podía reactivar
  // algo que las pantallas dan por muerto.
  const { data: existing } = await supabase
    .from('flows')
    .select('id, workspace_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json(
      { error: translate(locale, 'errFlows.notFound') },
      { status: 404 },
    )
  }

  // La validación, el cambio de estado y el snapshot publicado viven en
  // `@/lib/flows/write`: el chat agéntico prende menús por el mismo camino, y
  // una segunda activación que se saltee el validador es exactamente cómo queda
  // un menú roto atendiendo clientes.
  try {
    const resultado = await cambiarEstado(supabaseAdmin(), {
      flowId: id,
      workspaceId: (existing as { workspace_id: string }).workspace_id,
      estado: status,
      userId: user.id,
    })
    if (!resultado.ok) {
      return NextResponse.json(
        {
          error: translate(locale, 'errFlows.activateHasBlockers'),
          issues: resultado.issues,
        },
        { status: 422 },
      )
    }
    return NextResponse.json({ flow: resultado.flow })
  } catch (err) {
    return serverError(err)
  }
}
