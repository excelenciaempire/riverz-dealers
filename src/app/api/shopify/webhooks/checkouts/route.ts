import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyShopifyWebhook } from '@/lib/shopify/webhook-auth'
import { getConnectionByShop } from '@/lib/shopify/connection'
import {
  extractShopifyLegacyPhone,
  extractShopifyName,
  extractShopifyPhone,
  upsertWhatsappContact,
} from '@/lib/shopify/contact-upsert'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { isDuplicateDelivery } from '@/lib/shopify/webhook-dedup'
import { captureWebhookFailure } from '@/lib/webhooks/capture'

/**
 * Shopify checkout webhook receiver. Persiste cada checkout/abandoned
 * cart en `shopify_checkouts` para tener snapshot autoritativo del
 * carrito, la URL de recovery y los line items.
 *
 * El trigger `shopify_abandoned_checkout` ya NO se dispara desde acá:
 * un checkout recién creado no es un carrito abandonado. El cron
 * `/api/cron/shopify-cart-recovery` corre cada hora y escanea
 * checkouts con created_at < now() - 2h, completed_at IS NULL y
 * recovery_dispatched_at IS NULL, disparando el automation ahí. Eso
 * implementa el anti-spam (una sola recovery por checkout) y permite
 * cambiar la ventana sin tocar el webhook.
 *
 * Las updates igual se persisten para que el order/create pueda marcar
 * el checkout como `completed` matcheando por checkout_id.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const hmac = request.headers.get('x-shopify-hmac-sha256')
  const verdict = await verifyShopifyWebhook(supabaseAdmin(), request, rawBody)
  if (verdict === 'unconfigured') {
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }
  if (verdict === 'invalid') {
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
    const webhookId = request.headers.get('x-shopify-webhook-id')
    if (await isDuplicateDelivery(admin, shopDomain, webhookId, topic)) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    const conn = await getConnectionByShop(admin, shopDomain)
    if (!conn) return NextResponse.json({ ok: true })

    // Migration 055 made shopify_connections.workspace_id NOT NULL — read
    // it straight off the connection. The owner_id fallback stays as a
    // safety net for any pre-055 rows still in flight.
    const workspaceId =
      conn.row.workspace_id ||
      (await resolveWorkspaceIdForUser(admin, conn.row.user_id))
    if (!workspaceId) {
      console.warn(
        '[shopify] checkouts webhook: no workspace for connection',
        conn.row.id,
      )
      return NextResponse.json({ ok: true, skipped: 'no_workspace' })
    }
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

    // El resto del flujo (contact upsert) solo tiene sentido si hay
    // teléfono y si es un checkouts/create. Las updates siguen
    // alimentando la tabla.
    //
    // NOTA: ya no disparamos shopify_abandoned_checkout en el momento
    // de creación. La definición de "carrito abandonado" requiere que
    // hayan pasado al menos 2 horas sin completar — si firáramos al
    // segundo 0, la automation de Pilar mandaría el recovery a alguien
    // que sigue en el checkout. El cron de cart-recovery
    // (/api/cron/shopify-cart-recovery) escanea cada hora los
    // checkouts con created_at < now() - 2h, completed_at IS NULL y
    // recovery_dispatched_at IS NULL, y dispara ahí el automation.
    if (topic !== 'checkouts/create') {
      return NextResponse.json({ ok: true, persisted: true })
    }
    if (!phone) return NextResponse.json({ ok: true, skipped: 'no_phone' })

    const contactId = await upsertWhatsappContact(admin, {
      workspaceId,
      phone,
      name,
      email: email ?? undefined,
      legacyExternalId: extractShopifyLegacyPhone(checkout),
    })
    if (!contactId) return NextResponse.json({ ok: true })

    return NextResponse.json({ ok: true, queued_for_recovery_cron: true })
  } catch (err) {
    console.error('[shopify] checkouts webhook error:', err)
    await captureWebhookFailure({
      provider: `shopify:${topic}`,
      rawBody,
      signature: hmac,
      error: err,
    })
    return NextResponse.json({ ok: true })
  }
}
