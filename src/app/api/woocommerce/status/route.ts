import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { getPublicConnection } from '@/lib/commerce/connection'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * Estado de la conexión de WooCommerce.
 *
 * `configured: true` siempre: WooCommerce no necesita ninguna app ni
 * credencial nuestra del lado del servidor — las claves son del comercio
 * y se generan contra su propio sitio. Es la diferencia con Shopify y
 * Tiendanube, que dependen de que tengamos una app registrada.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  const connection = workspaceId
    ? await getPublicConnection(supabase, 'woocommerce', workspaceId)
    : null

  return NextResponse.json({ configured: true, connection })
}

/**
 * Desconecta la tienda. La clave de API sigue existiendo en el
 * WordPress del comercio: revocarla es una acción de su panel
 * (WooCommerce → Ajustes → Avanzado → REST API), no algo que podamos
 * hacer con una credencial que acabamos de borrar.
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

  const { error } = await supabase
    .from('shopify_connections')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('platform', 'woocommerce')
  if (error) return serverError(error)

  return NextResponse.json({ ok: true })
}
