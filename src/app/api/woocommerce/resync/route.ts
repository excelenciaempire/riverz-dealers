import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { getStoreForWorkspace, markStoreExpired } from '@/lib/commerce/connection'
import { resyncCatalog } from '@/lib/commerce/setup'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { StoreUnauthorizedError } from '@/lib/commerce/types'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('woocommerce.resync')

/** POST /api/woocommerce/resync — vuelve a traer el catálogo. */
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

  // Credenciales con el cliente de servicio (el de cookie no ve las
  // columnas de secretos); el workspace con la sesión del usuario, que es
  // lo que impide resincronizar una tienda ajena.
  const admin = supabaseAdmin()
  const store = await getStoreForWorkspace(admin, 'woocommerce', workspaceId)
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
        'woocommerce',
        store.shopDomain,
        'Claves rechazadas por WooCommerce — reconectar desde Ajustes',
      )
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    log.captureException(err, { workspaceId })
    return NextResponse.json({ error: 'sync_failed' }, { status: 500 })
  }
}
