import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { listar, rangoDe } from '@/lib/wallet/movimientos'

/**
 * El detalle: una línea por cada cosa que se cobró o se cargó.
 *
 * Es el respaldo del resumen. Sin esto, el panel dice "gastaste 12 dólares en
 * llamadas" y no hay forma de ver cuáles fueron — que es exactamente lo que
 * pregunta alguien cuando el número no le cierra.
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

  const p = new URL(request.url).searchParams
  const rango = rangoDe(p.get('desde'), p.get('hasta'))
  const pagina = Number(p.get('pagina') ?? 0)

  const { filas, hayMas } = await listar(admin, workspaceId, {
    rango,
    concepto: p.get('concepto'),
    tipo: p.get('tipo'),
    pagina: Number.isFinite(pagina) ? pagina : 0,
    porPagina: 50,
  })

  return NextResponse.json(
    { filas, hayMas, rango },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
