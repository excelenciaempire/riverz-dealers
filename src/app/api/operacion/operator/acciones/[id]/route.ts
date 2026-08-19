import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'
import { decideOperatorAction } from '@/lib/operator/actions'
import { getLocale } from '@/lib/i18n/server'

/**
 * Aprobar o rechazar lo que el Operator propuso.
 *
 * Es el único lugar donde el Operator cambia algo, y empieza en un click de
 * una persona. Lo que se ejecuta son los argumentos guardados al proponer, no
 * lo que diga el modelo después: aprobar significa aprobar eso.
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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })
  const flags = await getFeatureFlags(admin, workspaceId)
  if (!isRiverz2(flags)) return NextResponse.json({ error: 'not_available' }, { status: 404 })

  const { id } = await params
  const body = (await request.json().catch(() => null)) as { aprobar?: boolean } | null

  const out = await decideOperatorAction(admin, {
    actionId: id,
    workspaceId,
    userId: user.id,
    aprobar: body?.aprobar === true,
    locale: await getLocale(),
  })

  return NextResponse.json(out, { status: out.ok ? 200 : 400 })
}
