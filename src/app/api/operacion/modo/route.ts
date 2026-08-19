import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'

/**
 * Cómo trabaja el Operador: construyendo solo, o pidiendo permiso antes.
 *
 * Es una preferencia de la cuenta y no del navegador: si viviera en
 * localStorage, el mismo comercio tendría al Operador comportándose distinto
 * en la computadora del local y en el teléfono del dueño.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })
  if (!isRiverz2(await getFeatureFlags(admin, workspaceId))) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as { auto?: boolean } | null
  const auto = body?.auto === true

  const { error } = await admin.from('operacion_setup').upsert(
    { workspace_id: workspaceId, auto_build: auto, updated_at: new Date().toISOString() },
    { onConflict: 'workspace_id' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ auto })
}
