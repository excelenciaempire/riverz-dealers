import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { leerCortes } from '@/lib/dashboard/cortes'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * Quién atendió: por canal y por agente.
 *
 * Inicio contaba el volumen por canal y nada más, así que no se podía saber
 * dónde está trabajando la IA. Esto lo corta por los dos lados.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })

  const url = new URL(request.url)
  const ahora = Date.now()
  const desde = new Date(url.searchParams.get('start') ?? ahora - 30 * 86_400_000)
  const hasta = new Date(url.searchParams.get('end') ?? ahora)
  const ok = (d: Date) => !Number.isNaN(d.getTime())

  const cortes = await leerCortes(admin, workspaceId, {
    desde: ok(desde) ? desde : new Date(ahora - 30 * 86_400_000),
    hasta: ok(hasta) ? hasta : new Date(ahora),
  })

  return NextResponse.json(cortes, { headers: { 'Cache-Control': 'no-store' } })
}
