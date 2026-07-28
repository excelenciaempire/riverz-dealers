import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decodeState } from '@/lib/channels/oauth'
import { parseWooAuthCallback } from '@/lib/commerce/providers/woocommerce'
import { completeWooConnection } from '@/lib/commerce/setup'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('woocommerce.auth-callback')

/**
 * POST /api/woocommerce/auth/callback
 *
 * Acá aterrizan las claves generadas cuando el comercio aprueba el
 * acceso: lo POSTea SU WordPress, servidor a servidor, sin cookies ni
 * sesión y sin nada firmado por WooCommerce.
 *
 * Por eso la seguridad completa recae en el `user_id`: es el state que
 * NOSOTROS firmamos al iniciar el flujo y WooCommerce devuelve intacto.
 * Sin firma válida esto sería un endpoint público donde cualquiera podría
 * plantar credenciales sobre un workspace ajeno.
 *
 * El catálogo NO se sincroniza acá a propósito: este POST lo hace el
 * WordPress del comercio con su propio timeout, y una tienda de miles de
 * SKUs lo haría cortar con error aunque la conexión quedara perfecta. Lo
 * dispara la vuelta al navegador (/auth/return).
 */
export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const parsed = parseWooAuthCallback(payload)
  if (!parsed) {
    return NextResponse.json({ error: 'bad_payload' }, { status: 400 })
  }

  const state = decodeState(parsed.user_id)
  if (!state || state.channel !== 'woocommerce' || !state.userId || !state.storeDomain) {
    log.warn('invalid_state')
    return NextResponse.json({ error: 'invalid_state' }, { status: 401 })
  }

  // Solo aceptamos escritura si el permiso otorgado alcanza. WooCommerce
  // deja al comercio degradar el alcance en la pantalla de aprobación, y
  // una clave de solo lectura no puede ni crear los webhooks — mejor
  // decirlo ahora que dejar una conexión que nunca recibe pedidos.
  if (parsed.key_permissions && parsed.key_permissions !== 'read_write') {
    log.warn('insufficient_permissions', { got: parsed.key_permissions })
    return NextResponse.json({ error: 'insufficient_permissions' }, { status: 400 })
  }

  try {
    await completeWooConnection(supabaseAdmin(), {
      userId: state.userId,
      workspaceId: state.workspaceId,
      siteUrl: state.storeDomain,
      consumerKey: parsed.consumer_key,
      consumerSecret: parsed.consumer_secret,
      keyId: parsed.key_id,
      syncCatalog: false,
    })
    log.info('connected', {
      workspaceId: state.workspaceId,
      siteUrl: state.storeDomain,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    log.captureException(err, { workspaceId: state.workspaceId })
    // Un no-2xx acá hace que WooCommerce le muestre el error al comercio,
    // que es exactamente lo que queremos: la conexión no quedó hecha.
    return NextResponse.json({ error: 'connect_failed' }, { status: 500 })
  }
}
