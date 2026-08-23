import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getFeatureFlags, isRiverz2 } from '@/lib/admin/feature-flags'
import { csrfGuard } from '@/lib/csrf'
import { corridaViva, leerCorrida, pedirDetener } from '@/lib/operator/corridas'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * La corrida de un hilo: cómo va, y el botón de detenerla.
 *
 *   GET  ?thread=… → la corrida viva, con la foto de cómo va.
 *   GET  ?id=…     → esa corrida, para seguir mirándola.
 *   POST { id }    → pide detenerla. El turno lo mira entre vueltas.
 *
 * Es lo que hace que salir de la pantalla no sea cancelar. Quien vuelve pregunta
 * si hay algo corriendo y sigue mirando desde donde iba, en vez de encontrarse
 * su propio pedido sin respuesta.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function cuenta() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return null
  if (!isRiverz2(await getFeatureFlags(admin, workspaceId))) return null
  return { admin, workspaceId }
}

export async function GET(request: Request) {
  const c = await cuenta()
  if (!c) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const thread = url.searchParams.get('thread')

  const corrida = id
    ? await leerCorrida(c.admin, id, c.workspaceId)
    : thread
      ? await corridaViva(c.admin, thread, c.workspaceId)
      : null

  return NextResponse.json({ corrida }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const c = await cuenta()
  if (!c) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { id?: string } | null
  if (!body?.id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // Se pide, no se mata: el turno lo mira entre una vuelta y la siguiente.
  // Cortarlo a mitad de una llamada al modelo dejaría a medio hacer justo lo
  // que se estaba haciendo, y esa vuelta ya está pagada.
  await pedirDetener(c.admin, body.id, c.workspaceId)
  return NextResponse.json({ ok: true })
}
