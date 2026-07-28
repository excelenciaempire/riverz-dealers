import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getStoreByExternalId, markStoreUninstalled } from '@/lib/commerce/connection'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('tiendanube.privacy')

/**
 * Los tres webhooks de privacidad que Tiendanube exige a toda aplicación
 * publicada: `store/redact`, `customers/redact` y
 * `customers/data_request`.
 *
 * Van firmados igual que el resto de sus webhooks
 * (`x-linkedstore-hmac-sha256` sobre el cuerpo crudo, con el secreto de
 * la app) y su cuerpo también es mínimo: `{ store_id, event, id }`.
 *
 * Fail-closed: si falta el secreto respondemos 503 en vez de aceptar sin
 * verificar. Un endpoint de borrado sin autenticar sería una forma de que
 * un tercero nos vacíe datos de un comercio.
 */

function verify(rawBody: string, header: string | null): 'ok' | 'invalid' | 'unconfigured' {
  const secret = process.env.TIENDANUBE_CLIENT_SECRET
  if (!secret) return 'unconfigured'
  if (!header) return 'invalid'
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  try {
    const a = Buffer.from(digest, 'hex')
    const b = Buffer.from(header, 'hex')
    if (a.length !== b.length) return 'invalid'
    return timingSafeEqual(a, b) ? 'ok' : 'invalid'
  } catch {
    return 'invalid'
  }
}

export type PrivacyTopic = 'store_redact' | 'customers_redact' | 'customers_data_request'

export async function handleTiendanubePrivacy(
  request: Request,
  topic: PrivacyTopic,
): Promise<NextResponse> {
  const rawBody = await request.text()
  const verdict = verify(rawBody, request.headers.get('x-linkedstore-hmac-sha256'))
  if (verdict === 'unconfigured') {
    return new NextResponse('Webhook not configured', { status: 503 })
  }
  if (verdict === 'invalid') {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }

  let storeId = ''
  try {
    const body = JSON.parse(rawBody) as { store_id?: number | string }
    storeId = body.store_id != null ? String(body.store_id) : ''
  } catch {
    // Cuerpo ilegible: la firma ya validó, así que confirmamos igual en
    // vez de forzar reintentos que tampoco van a poder parsearse.
    return NextResponse.json({ ok: true })
  }

  // Solo `store/redact` implica borrado de nuestro lado. Los otros dos son
  // sobre un comprador concreto, y de ellos no guardamos nada indexable por
  // su id de Tiendanube: el contacto se crea a partir del teléfono y vive
  // atado al workspace, no a la tienda. Confirmamos sin borrar nada.
  if (topic !== 'store_redact' || !storeId) {
    return NextResponse.json({ ok: true })
  }

  try {
    const admin = supabaseAdmin()
    const store = await getStoreByExternalId(admin, 'tiendanube', storeId)
    if (!store) return NextResponse.json({ ok: true })

    // Lo que sí es dato de la tienda: su catálogo y sus carritos.
    await admin
      .from('shopify_products')
      .delete()
      .eq('platform', 'tiendanube')
      .eq('shop_domain', store.shopDomain)
    await admin
      .from('shopify_checkouts')
      .delete()
      .eq('platform', 'tiendanube')
      .eq('shop_domain', store.shopDomain)
    await markStoreUninstalled(admin, 'tiendanube', store.shopDomain)

    log.info('store_redacted', { shopDomain: store.shopDomain })
  } catch (err) {
    log.captureException(err, { storeId })
    // Confirmamos igual: Tiendanube exige 2xx y el reintento no arreglaría
    // un fallo nuestro de base de datos.
  }

  return NextResponse.json({ ok: true })
}
