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
import { CLAVE_BORRADOR, claveDeBorrador } from '@/lib/shopify/borradores'

/**
 * Borradores de pedido de Shopify ("Pedidos → Borradores").
 *
 * Un borrador es una venta que el comercio YA armó: tiene el cliente, los
 * productos y un `invoice_url`, que es un link de pago listo para usar. Está
 * esperando que alguien pague. Si nadie paga, se queda ahí para siempre y no
 * lo persigue nadie.
 *
 * Es un carrito abandonado, pero más caliente: en un carrito la persona se fue
 * sola; acá alguien del equipo ya habló con ella y le preparó el pedido.
 *
 * **Se guardan en `shopify_checkouts`, la misma tabla que los carritos**, y esa
 * decisión es el corazón de esta función. Con eso:
 *
 *   - los levanta el mismo cron (`/api/cron/shopify-cart-recovery`), sin una
 *     línea de código nueva;
 *   - salen por la MISMA plantilla, porque el disparador es el mismo
 *     (`shopify_abandoned_checkout`);
 *   - **no se duplican**: el cron ya deduplica por teléfono dentro de la
 *     corrida y contra las 24 h previas, así que quien tenga un carrito Y un
 *     borrador recibe un solo mensaje;
 *   - la atribución los cuenta igual, sin tocar `informe.ts`.
 *
 * El id va prefijado (`draft_<id>`) para que no pueda chocar con el token de un
 * checkout, y el `upsert` por `(shop_domain, checkout_id)` hace que las
 * actualizaciones repetidas de Shopify pisen la misma fila en vez de sumar.
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
  if (!topic.startsWith('draft_orders/')) {
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

    const workspaceId =
      conn.row.workspace_id ||
      (await resolveWorkspaceIdForUser(admin, conn.row.user_id))
    if (!workspaceId) {
      return NextResponse.json({ ok: true, skipped: 'no_workspace' })
    }

    const draft = JSON.parse(rawBody) as Record<string, unknown>
    const clave = claveDeBorrador(draft.id)
    if (!clave) return NextResponse.json({ ok: true, skipped: 'sin_id' })

    // `draft_orders/delete` sólo trae el id: el borrador ya no existe, así que
    // tampoco tiene que seguir en la cola de recuperación.
    if (topic === 'draft_orders/delete') {
      await admin
        .from('shopify_checkouts')
        .delete()
        .eq('shop_domain', shopDomain)
        .eq('checkout_id', clave)
      return NextResponse.json({ ok: true, borrado: true })
    }

    const phone = extractShopifyPhone(draft)
    const name = extractShopifyName(draft)
    const email = (draft.email as string) || null
    // Shopify marca `completed_at` cuando el borrador se convierte en pedido
    // pagado. Con eso puesto, el cron lo saltea solo — es la misma señal que
    // usa el carrito.
    const completedRaw = draft.completed_at as string | null | undefined
    const completedAt =
      completedRaw && completedRaw !== ''
        ? completedRaw
        : draft.status === 'completed'
          ? new Date().toISOString()
          : null

    const rawLineItems = Array.isArray(draft.line_items)
      ? (draft.line_items as Array<Record<string, unknown>>)
      : []
    const lineItems = rawLineItems.map((li) => ({
      title: li.title ?? null,
      quantity: li.quantity ?? null,
      price: li.price ?? null,
      variant_id: li.variant_id ?? null,
      product_id: li.product_id ?? null,
      image_url: null,
    }))
    const totalRaw = draft.total_price ?? null
    const total = totalRaw === null || totalRaw === '' ? null : Number(totalRaw)

    await admin.from('shopify_checkouts').upsert(
      {
        workspace_id: workspaceId,
        shop_domain: shopDomain,
        checkout_id: clave,
        customer_email: email,
        customer_phone: phone,
        customer_name: name ?? null,
        total_price: Number.isFinite(total as number) ? total : null,
        currency: (draft.currency as string | null) ?? null,
        line_items: lineItems,
        // El link de pago que ya armó Shopify. Es lo que viaja en el botón
        // "Terminar Pedido" de la plantilla, igual que el del carrito.
        abandoned_checkout_url: (draft.invoice_url as string | null) ?? null,
        status: completedAt ? 'completed' : 'open',
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_domain,checkout_id' },
    )

    // El contacto se crea igual que con un carrito: sin él la automatización no
    // tiene a quién escribirle. Sólo al nacer el borrador — las updates ya
    // encuentran el contacto hecho.
    if (topic === 'draft_orders/create' && phone) {
      await upsertWhatsappContact(admin, {
        workspaceId,
        phone,
        name,
        email: email ?? undefined,
        legacyExternalId: extractShopifyLegacyPhone(draft),
      })
    }

    return NextResponse.json({ ok: true, clave, prefijo: CLAVE_BORRADOR })
  } catch (err) {
    console.error('[shopify] draft_orders webhook error:', err)
    await captureWebhookFailure({
      provider: `shopify:${topic}`,
      rawBody,
      signature: hmac,
      error: err,
    })
    return NextResponse.json({ ok: true })
  }
}
