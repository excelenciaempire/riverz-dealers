import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { getStoreForWorkspace, markStoreExpired } from '@/lib/commerce/connection'
import { resyncCatalog } from '@/lib/commerce/setup'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { StoreUnauthorizedError } from '@/lib/commerce/types'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('tiendanube.resync')

/**
 * POST /api/tiendanube/resync — vuelve a traer el catálogo.
 *
 * Las credenciales se leen con el cliente de servicio porque el de
 * cookie no tiene permiso sobre las columnas de secretos (grant por
 * columna de la migración 126). El workspace, en cambio, se resuelve con
 * la sesión del usuario: es lo que evita que alguien resincronice una
 * tienda ajena.
 */
export async function POST(req: Request) {
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

  const admin = supabaseAdmin()
  const store = await getStoreForWorkspace(admin, 'tiendanube', workspaceId)
  if (!store || store.status !== 'active') {
    return NextResponse.json({ error: 'not_connected' }, { status: 400 })
  }

  try {
    const result = await resyncCatalog(admin, store)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof StoreUnauthorizedError) {
      await markStoreExpired(
        admin,
        'tiendanube',
        store.shopDomain,
        'Credencial revocada en Tiendanube — reconectar desde Ajustes',
      )
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    log.captureException(err, { workspaceId })
    return NextResponse.json({ error: 'sync_failed' }, { status: 500 })
  }
}
