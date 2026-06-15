import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyWebhookHmac } from '@/lib/shopify/oauth'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import {
  extractShopifyName,
  extractShopifyPhone,
  upsertWhatsappContact,
} from '@/lib/shopify/contact-upsert'

/**
 * Shopify checkout webhook receiver. Fires the
 * `shopify_abandoned_checkout` automation trigger when a checkout is
 * created, and persists the full checkout into `shopify_checkouts` for
 * any topic (create + update) so we keep an authoritative snapshot of
 * the cart, the recovery URL, and the line items even if the automation
 * never runs.
 *
 * Solo `checkouts/create` dispara la automation (un checkouts/update
 * llega cada vez que el cliente toca un campo y volvería a disparar el
 * trigger). Las updates igual se persisten — necesitamos el último
 * estado del carrito para recover y para marcar el checkout como
 * completado cuando llega un `orders/create` con el mismo token.
 */
export async function POST(request: Request) {
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiSecret) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }

  const rawBody = await request.text()
  const hmac = request.headers.get('x-shopify-hmac-sha256')
  if (!verifyWebhookHmac(rawBody, hmac, apiSecret)) {
    return new NextResponse('Invalid HMAC', { status: 401 })
  }

  const shopDomain = request.headers.get('x-shopify-shop-domain')
  const topic = request.headers.get('x-shopify-topic') || ''
  if (!shopDomain) return NextResponse.json({ ok: true })

  if (topic !== 'checkouts/create' && topic !== 'checkouts/update') {
    return NextResponse.json({ ok: true, ignored: topic })
  }

  try {
    const admin = supabaseAdmin()
    const conn = await getConnectionByShop(admin, shopDomain)
    if (!conn) return NextResponse.json({ ok: true })

    const workspaceId = conn.row.user_id
    const checkout = JSON.parse(rawBody) as Record<string, unknown>

    const phone = extractShopifyPhone(checkout)
    const name = extractShopifyName(checkout)
    const email = (checkout.email as string) || null
    const checkoutToken = String(checkout.token ?? checkout.id ?? '').trim()
    const completedAtRaw = checkout.completed_at as string | null | undefined
    const completedAt = completedAtRaw && completedAtRaw !== '' ? completedAtRaw : null

    // Persistir el snapshot completo del checkout SIEMPRE, aún sin
    // teléfono — el carrito sigue siendo valioso para analítica.
    if (checkoutToken) {
      const rawLineItems = Array.isArray(checkout.line_items)
        ? (checkout.line_items as Array<Record<string, unknown>>)
        : []
      const lineItems = rawLineItems.map((li) => ({
        title: li.title ?? null,
        quantity: li.quantity ?? null,
        price: li.price ?? null,
        variant_id: li.variant_id ?? null,
        product_id: li.product_id ?? null,
        image_url: li.image_url ?? null,
      }))
      const totalPriceRaw = checkout.total_price ?? null
      const totalPrice =
        totalPriceRaw === null || totalPriceRaw === ''
          ? null
          : Number(totalPriceRaw)

      await admin.from('shopify_checkouts').upsert(
        {
          workspace_id: workspaceId,
          shop_domain: shopDomain,
          checkout_id: checkoutToken,
          customer_email: email,
          customer_phone: phone,
          customer_name: name ?? null,
          total_price: Number.isFinite(totalPrice as number)
            ? totalPrice
            : null,
          currency:
            (checkout.currency as string | null) ??
            (checkout.presentment_currency as string | null) ??
            null,
          line_items: lineItems,
          abandoned_checkout_url:
            (checkout.abandoned_checkout_url as string | null) ??
            (checkout.checkout_url as string | null) ??
            null,
          status: completedAt ? 'completed' : 'open',
          completed_at: completedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'shop_domain,checkout_id' },
      )
    }

    // El resto del flujo (contact upsert + automation dispatch) solo
    // tiene sentido si hay teléfono y si es un checkouts/create. Las
    // updates siguen alimentando la tabla pero no re-disparan la
    // automation.
    if (topic !== 'checkouts/create') {
      return NextResponse.json({ ok: true, persisted: true })
    }
    if (!phone) return NextResponse.json({ ok: true, skipped: 'no_phone' })

    const contactId = await upsertWhatsappContact(admin, {
      workspaceId,
      phone,
      name,
      email: email ?? undefined,
    })
    if (!contactId) return NextResponse.json({ ok: true })

    runAutomationsForTrigger({
      workspaceId,
      triggerType: 'shopify_abandoned_checkout',
      contactId,
      context: {
        vars: {
          checkout_url:
            (checkout.abandoned_checkout_url as string | undefined) ??
            (checkout.checkout_url as string | undefined) ??
            '',
          total_price: String(checkout.total_price ?? ''),
          currency: String(
            checkout.currency ?? checkout.presentment_currency ?? '',
          ),
          customer_name: name ?? '',
          checkout_token: String(checkout.token ?? ''),
        },
      },
    }).catch((err) => console.error('[shopify] dispatch failed:', err))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[shopify] checkouts webhook error:', err)
    return NextResponse.json({ ok: true })
  }
}
