import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'
import { leerActividad } from '@/lib/operator/actividad'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * Lo que hizo el Operador en la cuenta, y lo que costó.
 *
 * Sólo lectura y sólo de la propia cuenta: el id sale de la sesión y nunca de
 * un parámetro.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DIAS_POR_DEFECTO = 30
const TOPE_DIAS = 365

export async function GET(request: Request) {
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

  const pedidos = Number(new URL(request.url).searchParams.get('dias'))
  const dias =
    Number.isFinite(pedidos) && pedidos > 0 ? Math.min(pedidos, TOPE_DIAS) : DIAS_POR_DEFECTO
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)

  const actividad = await leerActividad(admin, workspaceId, desde)
  return NextResponse.json(
    { ...actividad, dias },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
