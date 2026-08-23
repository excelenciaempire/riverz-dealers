import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'
import { csrfGuard } from '@/lib/csrf'
import { findCapability } from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import { getLocale } from '@/lib/i18n/server'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * Volver atrás algo que el Operador ya hizo.
 *
 * Deshace la capacidad, no la fila: cada una sabe cómo se vuelve atrás lo suyo
 * —borrar la automatización que creó, devolver el interruptor a donde estaba— y
 * las que no se pueden deshacer simplemente no lo declaran. Un mensaje enviado,
 * una plantilla en Meta o una llamada hecha no vuelven, y no hay forma de pedir
 * lo contrario desde acá.
 *
 * La fila NO se borra: pasa a `deshecho`. La acción ocurrió y después se
 * revirtió, y esconder la primera mitad sería lo contrario de un registro.
 */
export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request)
  if (block) return block

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })
  if (!isRiverz2(await getFeatureFlags(admin, workspaceId))) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 })
  }

  const { id } = await params
  const { data } = await admin
    .from('operator_actions')
    .select('capability_key, status, args, result')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const fila = data as {
    capability_key: string
    status: string
    args: Record<string, unknown>
    result: unknown
  } | null

  if (!fila) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (fila.status !== 'ejecutado') {
    return NextResponse.json({ error: 'no_ejecutado' }, { status: 400 })
  }

  const cap = findCapability(fila.capability_key)
  if (!cap?.deshacer) {
    return NextResponse.json({ error: 'no_se_deshace' }, { status: 400 })
  }

  const ctx: CapabilityContext = {
    db: admin,
    workspaceId,
    actor: { type: 'operator', id: user.id },
    locale: await getLocale(),
  }

  try {
    const que = await cap.deshacer(ctx, fila.args, fila.result)
    await admin
      .from('operator_actions')
      .update({
        status: 'deshecho',
        undone_at: new Date().toISOString(),
        undone_by: user.id,
      })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
    return NextResponse.json({ ok: true, que })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'no se pudo deshacer' },
      { status: 400 },
    )
  }
}
