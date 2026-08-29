import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { estadoDeCobro } from '@/lib/wallet/puerta'

/**
 * El saldo, y nada más.
 *
 * `/api/wallet/estado` devuelve todo lo que la pantalla de Saldo necesita —el
 * libro, las tarifas, los costos— y son cinco consultas. El número que va en el
 * menú se refresca en cada navegación: pedirlo por ahí sería pagar cinco
 * consultas para pintar cuatro caracteres.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 400 })

  const { vistazo } = await estadoDeCobro(admin, workspaceId)
  return NextResponse.json(vistazo, { headers: { 'Cache-Control': 'no-store' } })
}
