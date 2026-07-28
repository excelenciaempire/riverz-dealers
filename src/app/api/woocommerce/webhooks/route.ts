import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  getStoreByDomain,
  getStoreWebhookSecret,
} from '@/lib/commerce/connection'
import {
  normalizeWooOrder,
  normalizeWooSiteUrl,
  verifyWooSignature,
} from '@/lib/commerce/providers/woocommerce'
import { ingestOrder } from '@/lib/commerce/ingest'
import { isDuplicateDelivery } from '@/lib/shopify/webhook-dedup'
import { captureWebhookFailure } from '@/lib/webhooks/capture'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('woocommerce.webhook')

/**
 * Receptor de webhooks de WooCommerce.
 *
 * A diferencia de Tiendanube, el cuerpo trae el recurso completo, así
 * que no hace falta volver a consultar la API — un pedido se procesa aun
 * si las claves quedaron revocadas después.
 *
 * La tienda se identifica por `x-wc-webhook-source` (la URL del sitio) y
 * la firma se verifica con el secreto POR TIENDA que generamos al
 * conectar. Esto importa: si verificáramos con un secreto global, el
 * WordPress de cualquier comercio conectado podría firmar eventos a
 * nombre de otro.
 */

/** El host de la tienda que envió la entrega, desde el header de origen. */
function resolveSource(request: Request): string | null {
  const source = request.headers.get('x-wc-webhook-source')
  if (!source) return null
  return normalizeWooSiteUrl(source)
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-wc-webhook-signature')
  const topic = request.headers.get('x-wc-webhook-topic') || ''

  const shopDomain = resolveSource(request)
  if (!shopDomain) {
    // WooCommerce hace un "ping" sin firma ni origen al crear el webhook
    // (cuerpo `webhook_id=…`). Lo aceptamos: si respondiéramos error,
    // WooCommerce desactivaría el webhook recién creado.
    return NextResponse.json({ ok: true, ping: true })
  }

  try {
    const admin = supabaseAdmin()

    const secret = await getStoreWebhookSecret(admin, 'woocommerce', shopDomain)
    if (!secret) {
      // Sin secreto no podemos distinguir una entrega legítima de una
      // falsificada. Rechazamos en vez de confiar en el header de origen,
      // que cualquiera puede escribir.
      return new NextResponse('Not configured', { status: 401 })
    }
    if (!verifyWooSignature(rawBody, signature, secret)) {
      return new NextResponse('Invalid signature', { status: 401 })
    }

    if (!topic.startsWith('order.')) {
      return NextResponse.json({ ok: true, ignored: topic })
    }

    const store = await getStoreByDomain(admin, 'woocommerce', shopDomain)
    if (!store) return NextResponse.json({ ok: true, skipped: 'no_connection' })

    const order = normalizeWooOrder(JSON.parse(rawBody))
    if (!order) return NextResponse.json({ ok: true, skipped: 'unparsable' })

    // Dedupe por entrega. WooCommerce reintenta y, con varios webhooks
    // apuntando a la misma URL, un mismo cambio puede llegar por dos
    // topics distintos.
    const deliveryId = request.headers.get('x-wc-webhook-delivery-id')
    const dedupeKey = deliveryId || `${topic}:${order.externalId}`
    if (await isDuplicateDelivery(admin, shopDomain, dedupeKey, topic)) {
      return NextResponse.json({ ok: true, duplicate: true })
    }

    const result = await ingestOrder(admin, {
      platform: 'woocommerce',
      workspaceId: store.workspaceId,
      shopDomain,
      order,
      isCreate: topic === 'order.created',
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    log.captureException(err, { shopDomain, topic })
    await captureWebhookFailure({
      provider: `woocommerce:${topic}`,
      rawBody,
      signature,
      error: err,
    })
    return NextResponse.json({ ok: true })
  }
}
