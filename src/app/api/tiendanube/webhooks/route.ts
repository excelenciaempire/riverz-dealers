import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  getStoreByExternalId,
  markStoreExpired,
  markStoreUninstalled,
} from '@/lib/commerce/connection'
import {
  TiendanubeClient,
  normalizeTiendanubeOrder,
} from '@/lib/commerce/providers/tiendanube'
import { ingestOrder } from '@/lib/commerce/ingest'
import { isDuplicateDelivery } from '@/lib/shopify/webhook-dedup'
import { captureWebhookFailure } from '@/lib/webhooks/capture'
import { StoreUnauthorizedError } from '@/lib/commerce/types'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('tiendanube.webhook')

/**
 * Receptor de webhooks de Tiendanube.
 *
 * Particularidad que define todo el handler: el cuerpo NO trae el
 * recurso, solo `{ store_id, event, id }`. Hay que ir a buscar el pedido
 * a la API con las credenciales de esa tienda, así que una credencial
 * revocada no solo rompe las consultas — deja de procesar eventos.
 *
 * La firma va en `x-linkedstore-hmac-sha256` y se calcula con el secreto
 * de la APP (uno solo, global), no con un secreto por tienda como en
 * WooCommerce.
 */

/** HMAC-SHA256 hexadecimal sobre el cuerpo crudo, con el secreto de la app. */
function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.TIENDANUBE_CLIENT_SECRET
  if (!secret || !header) return false
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  try {
    const a = Buffer.from(digest, 'hex')
    const b = Buffer.from(header, 'hex')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

interface TiendanubeWebhookBody {
  store_id?: number | string
  event?: string
  id?: number | string
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-linkedstore-hmac-sha256')

  if (!process.env.TIENDANUBE_CLIENT_SECRET) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  if (!verifySignature(rawBody, signature)) {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }

  let body: TiendanubeWebhookBody
  try {
    body = JSON.parse(rawBody) as TiendanubeWebhookBody
  } catch {
    return NextResponse.json({ ok: true, ignored: 'bad_json' })
  }

  const storeId = body.store_id != null ? String(body.store_id) : ''
  const event = body.event ?? ''
  const resourceId = body.id != null ? String(body.id) : ''
  if (!storeId || !event) return NextResponse.json({ ok: true })

  try {
    const admin = supabaseAdmin()

    if (event === 'app/uninstalled') {
      // Buscamos la conexión SIN exigir que esté activa: puede haber
      // quedado marcada expirada por un 401 previo y aun así hay que
      // cerrarla correctamente.
      const store = await getStoreByExternalId(admin, 'tiendanube', storeId)
      if (store) {
        await markStoreUninstalled(admin, 'tiendanube', store.shopDomain)
      }
      return NextResponse.json({ ok: true, uninstalled: true })
    }

    if (!event.startsWith('order/') || !resourceId) {
      return NextResponse.json({ ok: true, ignored: event })
    }

    const store = await getStoreByExternalId(admin, 'tiendanube', storeId)
    if (!store) return NextResponse.json({ ok: true, skipped: 'no_connection' })
    if (!store.externalStoreId) {
      return NextResponse.json({ ok: true, skipped: 'no_store_id' })
    }

    // Deduplicación por (tienda, evento+recurso). Tiendanube no manda un
    // id de entrega, así que la clave es el propio evento sobre el
    // recurso: dos entregas de `order/paid` para el mismo pedido son
    // efectivamente la misma noticia y no deben re-anunciarse.
    if (
      await isDuplicateDelivery(
        admin,
        store.shopDomain,
        `${event}:${resourceId}`,
        event,
      )
    ) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const client = new TiendanubeClient(
      store.externalStoreId,
      store.accessToken,
      store.shopDomain,
    )
    const raw = await client.get<unknown>(`/orders/${resourceId}`)
    const order = normalizeTiendanubeOrder(raw, {})
    if (!order) return NextResponse.json({ ok: true, skipped: 'unparsable' })

    const result = await ingestOrder(admin, {
      platform: 'tiendanube',
      workspaceId: store.workspaceId,
      shopDomain: store.shopDomain,
      order,
      isCreate: event === 'order/created',
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof StoreUnauthorizedError) {
      // Credencial revocada: la marcamos para que Ajustes muestre
      // "Reconectar" en vez de un check verde sobre una tienda muda.
      await markStoreExpired(
        supabaseAdmin(),
        'tiendanube',
        err.shopDomain,
        'Credencial revocada en Tiendanube — reconectar desde Ajustes',
      )
      return NextResponse.json({ ok: true, skipped: 'unauthorized' })
    }
    log.captureException(err, { storeId, event })
    await captureWebhookFailure({
      provider: `tiendanube:${event}`,
      rawBody,
      signature,
      error: err,
    })
    // 200 igual: Tiendanube reintenta ante error y ya guardamos la
    // entrega cruda para reprocesarla a mano si hiciera falta.
    return NextResponse.json({ ok: true })
  }
}
