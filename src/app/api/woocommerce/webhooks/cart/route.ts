import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  getStoreByDomain,
  getStoreWebhookSecret,
} from '@/lib/commerce/connection'
import {
  normalizeWooSiteUrl,
  verifyWooSignature,
} from '@/lib/commerce/providers/woocommerce'
import { ingestCheckout } from '@/lib/commerce/ingest'
import type { NormalizedLineItem } from '@/lib/commerce/types'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('woocommerce.cart')

/**
 * Carritos abandonados de WooCommerce, enviados por el plugin de Riverz.
 *
 * WooCommerce no tiene carritos abandonados en el núcleo. El receptor de
 * pedidos ya rescata a quien apretó "realizar pedido" y no pagó (queda un
 * pedido `pending`), pero a quien abandona ANTES de eso solo se lo puede
 * ver desde adentro de la tienda. De ahí el plugin: captura el checkout
 * en curso apenas el comprador deja su correo o su teléfono, y lo manda
 * acá.
 *
 * Se firma igual que los webhooks nativos de WooCommerce
 * (`x-wc-webhook-signature`, base64 de HMAC-SHA256 sobre el cuerpo) con
 * el MISMO secreto por tienda que generamos al conectar. Así el plugin no
 * necesita credenciales propias: el comercio pega el secreto que ya
 * existe y no hay una segunda cosa que rotar.
 */

interface CartPayload {
  /** Identificador estable del carrito del lado del plugin (sesión). */
  cart_token?: string
  email?: string | null
  phone?: string | null
  name?: string | null
  country?: string | null
  currency?: string | null
  total?: string | number | null
  /** Link que restaura el carrito y lleva al checkout. */
  recovery_url?: string | null
  /** ISO. Cuándo empezó el carrito, no cuándo nos enteramos. */
  created_at?: string | null
  /** Presente cuando el carrito se convirtió en pedido. */
  completed?: boolean
  items?: Array<{
    name?: string
    quantity?: number
    price?: string | number
    product_id?: number
    variation_id?: number
    image?: string
  }>
}

function toItems(payload: CartPayload): NormalizedLineItem[] {
  if (!Array.isArray(payload.items)) return []
  return payload.items.map((it) => ({
    title: it.name ?? null,
    quantity: it.quantity ?? null,
    price: it.price != null ? String(it.price) : null,
    variantId: it.variation_id || null,
    productId: it.product_id ?? null,
    imageUrl: it.image ?? null,
  }))
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-wc-webhook-signature')

  const shopDomain = normalizeWooSiteUrl(
    request.headers.get('x-wc-webhook-source') || '',
  )
  if (!shopDomain) {
    return NextResponse.json({ error: 'missing_source' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()

    const secret = await getStoreWebhookSecret(admin, 'woocommerce', shopDomain)
    if (!secret) {
      // Sin secreto no distinguimos una entrega legítima de una falsificada.
      // Rechazamos antes que confiar en el header de origen, que cualquiera
      // puede escribir.
      return new NextResponse('Not configured', { status: 401 })
    }
    if (!verifyWooSignature(rawBody, signature, secret)) {
      return new NextResponse('Invalid signature', { status: 401 })
    }

    const store = await getStoreByDomain(admin, 'woocommerce', shopDomain)
    if (!store) return NextResponse.json({ ok: true, skipped: 'no_connection' })

    let payload: CartPayload
    try {
      payload = JSON.parse(rawBody) as CartPayload
    } catch {
      return NextResponse.json({ ok: true, ignored: 'bad_json' })
    }

    const token = (payload.cart_token ?? '').trim()
    if (!token) return NextResponse.json({ ok: true, ignored: 'no_token' })

    // Prefijo propio: distingue el carrito capturado por el plugin del que
    // deriva de un pedido sin cobrar (`order:…`), de modo que un mismo
    // comprador no genere dos filas que compitan entre sí.
    const checkoutId = `cart:${token}`

    // El comprador terminó comprando: cerramos el carrito para que el cron
    // de recuperación no le escriba.
    if (payload.completed) {
      const now = new Date().toISOString()
      await admin
        .from('shopify_checkouts')
        .update({ status: 'completed', completed_at: now, updated_at: now })
        .eq('shop_domain', shopDomain)
        .eq('checkout_id', checkoutId)
        .is('completed_at', null)
      return NextResponse.json({ ok: true, completed: true })
    }

    const total =
      payload.total != null && payload.total !== ''
        ? Number(payload.total)
        : null

    const { persisted } = await ingestCheckout(admin, {
      platform: 'woocommerce',
      workspaceId: store.workspaceId,
      shopDomain,
      checkout: {
        checkoutId,
        customer: {
          name: payload.name ?? null,
          email: payload.email ?? null,
          phone: payload.phone ?? null,
          countryCode: payload.country ?? null,
          ordersCount: 0,
        },
        totalPrice: Number.isFinite(total as number) ? total : null,
        currency: payload.currency ?? store.currency,
        lineItems: toItems(payload),
        recoveryUrl: payload.recovery_url ?? null,
        completedAt: null,
        createdAt: payload.created_at ?? null,
      },
    })

    return NextResponse.json({ ok: true, persisted })
  } catch (err) {
    log.captureException(err, { shopDomain })
    return NextResponse.json({ ok: true })
  }
}
