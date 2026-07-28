import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { getPublicConnection } from '@/lib/commerce/connection'
import { tiendanubeConfigured } from '@/lib/commerce/providers/tiendanube'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/** Estado de la conexión de Tiendanube para la tarjeta de Ajustes. */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  const connection = workspaceId
    ? await getPublicConnection(supabase, 'tiendanube', workspaceId)
    : null

  return NextResponse.json({
    configured: tiendanubeConfigured(),
    connection,
  })
}

/**
 * Desconecta la tienda. Solo borra la fila de Riverz: la app sigue
 * instalada del lado de Tiendanube (desinstalarla es una acción del
 * comercio en SU panel, y su webhook `app/uninstalled` cerrará la
 * conexión si lo hace).
 */
export async function DELETE(req: Request) {
  const block = await csrfGuard(req)
  if (block) return block

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json({ error: 'no workspace' }, { status: 400 })
  }

  // El filtro por plataforma no es opcional: sin él, desconectar
  // Tiendanube borraría también la conexión de Shopify del workspace.
  const { error } = await supabase
    .from('shopify_connections')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('platform', 'tiendanube')
  if (error) return serverError(error)

  return NextResponse.json({ ok: true })
}
