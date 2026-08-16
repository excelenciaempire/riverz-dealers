import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * GET /api/stores/platforms → { platforms: ['shopify', 'tiendanube', …] }
 *
 * Qué tiendas tiene conectadas esta cuenta, sin secretos. Lo usa el
 * constructor de automatizaciones para decidir si ofrece el filtro por
 * plataforma: con una sola tienda, elegir plataforma es una decisión que no
 * existe, y una opción que nunca cambia nada sólo agrega ruido.
 *
 * Devuelve lista vacía ante cualquier problema — el filtro se esconde y la
 * automatización se comporta como siempre (dispara con cualquier tienda).
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ platforms: [] })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) return NextResponse.json({ platforms: [] })

  const { data } = await supabaseAdmin()
    .from('shopify_connections')
    .select('platform')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')

  const platforms = [
    ...new Set(
      ((data ?? []) as { platform?: string | null }[])
        .map((r) => r.platform ?? 'shopify')
        .filter(Boolean),
    ),
  ]
  return NextResponse.json({ platforms })
}
