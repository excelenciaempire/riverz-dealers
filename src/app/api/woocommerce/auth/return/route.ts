import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decodeState } from '@/lib/channels/oauth'
import { getStoreForWorkspace, markStoreExpired } from '@/lib/commerce/connection'
import { resyncCatalog } from '@/lib/commerce/setup'
import { StoreUnauthorizedError } from '@/lib/commerce/types'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('woocommerce.auth-return')

/**
 * GET /api/woocommerce/auth/return?success=1&user_id=<state>
 *
 * Vuelta del comercio al navegador después de aprobar (o rechazar) el
 * acceso. Las claves ya llegaron por el callback servidor-a-servidor;
 * acá cerramos con lo que no entraba en ese POST: traer el catálogo.
 *
 * Se hace en esta request porque es del navegador del comercio, que
 * tolera unos segundos, a diferencia del callback que corre contra el
 * timeout de su propio WordPress.
 */
function bounce(request: Request, params: Record<string, string>): NextResponse {
  const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
  const url = new URL('/integraciones', base)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const success = url.searchParams.get('success')
  const rawState = url.searchParams.get('user_id')

  if (success !== '1') {
    return bounce(request, { woocommerce: 'error', reason: 'denied' })
  }

  const state = rawState ? decodeState(rawState) : null
  if (!state || state.channel !== 'woocommerce') {
    // El state puede haber expirado durante la aprobación. La conexión
    // igual quedó hecha por el callback, así que no es un error del
    // comercio: solo no podemos sincronizar el catálogo desde acá.
    return bounce(request, { woocommerce: 'connected' })
  }

  try {
    const admin = supabaseAdmin()
    const store = await getStoreForWorkspace(admin, 'woocommerce', state.workspaceId)
    if (!store || store.status !== 'active') {
      return bounce(request, { woocommerce: 'error', reason: 'not_connected' })
    }
    const result = await resyncCatalog(admin, store)
    return bounce(request, {
      woocommerce: 'connected',
      products: String(result.synced),
    })
  } catch (err) {
    if (err instanceof StoreUnauthorizedError) {
      await markStoreExpired(
        supabaseAdmin(),
        'woocommerce',
        err.shopDomain,
        'Claves rechazadas por WooCommerce — reconectar desde Ajustes',
      )
      return bounce(request, { woocommerce: 'error', reason: 'unauthorized' })
    }
    log.captureException(err, { workspaceId: state.workspaceId })
    // La tienda quedó conectada aunque el catálogo no haya entrado; el
    // comercio puede reintentarlo con el botón de sincronizar.
    return bounce(request, { woocommerce: 'connected', reason: 'sync_failed' })
  }
}
