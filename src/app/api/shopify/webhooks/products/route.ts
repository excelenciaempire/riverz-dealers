import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyShopifyWebhook } from '@/lib/shopify/webhook-auth'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { productToRow, type ShopifyProduct } from '@/lib/shopify/product-sync'
import { refreshLivePricing } from '@/lib/shopify/live-pricing'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { captureWebhookFailure } from '@/lib/webhooks/capture'

const TOPICS = new Set(['products/create', 'products/update', 'products/delete'])

/**
 * El espejo del catálogo antes era una foto tomada al conectar la tienda. Este
 * webhook la convierte en un espejo real: crear, editar o borrar un producto
 * se refleja antes de que el próximo cliente pregunte.
 *
 * No usa el dedupe global a propósito: upsert/delete son idempotentes y, si la
 * base falla, devolvemos 500 para que Shopify reintente la misma entrega.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const admin = supabaseAdmin()
  const verdict = await verifyShopifyWebhook(admin, request, rawBody)
  if (verdict === 'unconfigured') {
    return new NextResponse('Webhook not configured', { status: 503 })
  }
  if (verdict === 'invalid') return new NextResponse('Invalid HMAC', { status: 401 })

  const shopDomain = request.headers.get('x-shopify-shop-domain')
  const topic = request.headers.get('x-shopify-topic') || ''
  if (!shopDomain || !TOPICS.has(topic)) {
    return NextResponse.json({ ok: true, ignored: topic || 'missing_shop' })
  }

  try {
    const conn = await getConnectionByShop(admin, shopDomain)
    if (!conn) return NextResponse.json({ ok: true, skipped: 'no_connection' })
    const workspaceId =
      conn.row.workspace_id || (await resolveWorkspaceIdForUser(admin, conn.row.user_id))
    if (!workspaceId) return NextResponse.json({ ok: true, skipped: 'no_workspace' })

    const payload = JSON.parse(rawBody) as ShopifyProduct
    const externalId = Number(payload.id)
    if (!Number.isFinite(externalId)) {
      return NextResponse.json({ ok: true, skipped: 'invalid_product' })
    }

    if (topic === 'products/delete') {
      const { error } = await admin
        .from('shopify_products')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('platform', 'shopify')
        .eq('shop_domain', shopDomain)
        .eq('external_id', externalId)
      if (error) throw error
      return NextResponse.json({ ok: true, deleted: true })
    }

    const { data: existing } = await admin
      .from('shopify_products')
      .select('url')
      .eq('workspace_id', workspaceId)
      .eq('shop_domain', shopDomain)
      .eq('external_id', externalId)
      .maybeSingle()
    let publicDomain: string | null = null
    if (typeof existing?.url === 'string') {
      try {
        publicDomain = new URL(existing.url).host
      } catch {
        /* cae al dominio administrativo */
      }
    }
    const currency =
      typeof (conn.row as unknown as { currency?: unknown }).currency === 'string'
        ? ((conn.row as unknown as { currency: string }).currency || null)
        : null
    const row = productToRow(
      payload,
      { userId: conn.row.user_id, workspaceId, shopDomain },
      currency,
      publicDomain,
    )
    const { data: saved, error } = await admin
      .from('shopify_products')
      .upsert(row, { onConflict: 'shop_domain,external_id' })
      .select('id')
      .single()
    if (error || !saved) throw error ?? new Error('product upsert returned no row')

    // El webhook trae el precio base. La página trae el precio que la clienta
    // realmente ve después de aplicar el bundle; se actualiza best-effort.
    await refreshLivePricing(admin, String(saved.id)).catch(() => null)
    return NextResponse.json({ ok: true, updated: true })
  } catch (error) {
    console.error('[shopify] products webhook error:', error)
    await captureWebhookFailure({
      provider: `shopify:${topic}`,
      rawBody,
      signature: request.headers.get('x-shopify-hmac-sha256'),
      error,
    })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
