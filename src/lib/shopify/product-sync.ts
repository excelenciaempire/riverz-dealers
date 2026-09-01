import type { SupabaseClient } from '@supabase/supabase-js'
import { ShopifyAdminClient } from './admin-client'
import { detectBundleApp } from '@/lib/products/bundle-detection'

/**
 * Pull the store's product catalog into shopify_products. Upserts by
 * (shop_domain, external_id) so a re-sync just refreshes prices /
 * descriptions / tags in place — no duplicates and existing
 * ai_agent_products bindings keep working.
 *
 * Pagination is naive (250 per page, up to 10 pages = 2500 SKUs).
 * That covers virtually every Riverz tenant — for the few stores
 * that exceed it we can switch to cursor pagination later.
 */
export async function syncShopifyProducts(
  db: SupabaseClient,
  args: {
    userId: string
    workspaceId: string
    shopDomain: string
    accessToken: string
  },
): Promise<{ synced: number; deleted: number; bundlesDetected: number }> {
  const client = new ShopifyAdminClient(args.shopDomain, args.accessToken)

  // Divisa real de la tienda (ISO 4217 de /shop.json). Antes NO la
  // guardábamos: cada producto quedaba con currency=null y todo el resto
  // (agentes, checkout) caía a un 'ARS' hardcodeado. La detectamos una vez
  // y la estampamos en cada producto + en la conexión, para que sea la
  // divisa canónica del workspace. Fail-open: si falla, seguimos con null
  // (comportamiento anterior).
  let shopCurrency: string | null = null
  // Y el dominio con el que la tienda se muestra al público. El enlace de cada
  // producto se armaba con `shopDomain`, que es el `*.myshopify.com` con el que
  // hablamos con la API — así que el link que el agente le pasa a un cliente
  // decía "j9kgap-kn.myshopify.com" en vez del dominio de la tienda. Se ve mal
  // y, en una tienda con la vidriera restringida, ni siquiera abre.
  // `shop.domain` es el dominio principal, y ya lo pedíamos para la divisa.
  let dominioPublico: string | null = null
  try {
    const info = await client.getShopInfo()
    shopCurrency = info.currency || null
    dominioPublico = info.domain || null
  } catch {
    /* seguimos sin divisa ni dominio — no bloqueamos el sync del catálogo */
  }
  if (shopCurrency) {
    await db
      .from('shopify_connections')
      .update({ currency: shopCurrency })
      .eq('platform', 'shopify')
      .eq('workspace_id', args.workspaceId)
      .eq('shop_domain', args.shopDomain)
  }

  const PAGE = 250
  const MAX_PAGES = 10
  const allProducts: ShopifyProduct[] = []
  let sinceId = 0
  for (let i = 0; i < MAX_PAGES; i++) {
    const path = `/products.json?limit=${PAGE}${sinceId ? `&since_id=${sinceId}` : ''}`
    const body = await client.rest<{ products: ShopifyProduct[] }>(path)
    const batch = body.products ?? []
    if (batch.length === 0) break
    allProducts.push(...batch)
    sinceId = batch[batch.length - 1].id
    if (batch.length < PAGE) break
  }

  if (allProducts.length === 0) return { synced: 0, deleted: 0, bundlesDetected: 0 }

  const rows = allProducts.map((p) => productToRow(p, args, shopCurrency, dominioPublico))
  const bundlesDetected = rows.filter((r) => Boolean(r.is_bundle)).length

  // Upsert in chunks — PostgREST caps the request payload.
  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await db
      .from('shopify_products')
      .upsert(chunk, { onConflict: 'shop_domain,external_id' })
    if (error) {
      console.error('[shopify] product upsert failed:', error)
      throw new Error(`product upsert failed: ${error.message}`)
    }
  }

  // Garbage-collect rows for products no longer in the store.
  const externalIds = allProducts.map((p) => p.id)
  const { data: existing } = await db
    .from('shopify_products')
    .select('id, external_id')
    .eq('shop_domain', args.shopDomain)
  const stale =
    ((existing ?? []) as { id: string; external_id: number }[])
      .filter((row) => !externalIds.includes(Number(row.external_id)))
      .map((row) => row.id) ?? []
  if (stale.length > 0) {
    await db.from('shopify_products').delete().in('id', stale)
  }

  return { synced: rows.length, deleted: stale.length, bundlesDetected }
}

export interface ShopifyProductVariant {
  price?: string
  compare_at_price?: string
}

export interface ShopifyProductImage {
  src?: string
}

export interface ShopifyProduct {
  id: number
  handle: string
  title: string
  body_html?: string
  product_type?: string
  vendor?: string
  tags?: string
  variants?: ShopifyProductVariant[]
  image?: ShopifyProductImage
  images?: ShopifyProductImage[]
}

export function productToRow(
  p: ShopifyProduct,
  args: { userId: string; workspaceId: string; shopDomain: string },
  shopCurrency: string | null,
  /** El dominio de cara al público; sin él se cae al `*.myshopify.com`. */
  dominioPublico: string | null,
): Record<string, unknown> {
  const prices = (p.variants ?? [])
    .map((v) => Number(v.price))
    .filter((n) => Number.isFinite(n) && n > 0)
  const min = prices.length ? Math.min(...prices) : null
  const max = prices.length ? Math.max(...prices) : null
  const tags = (p.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  // Detectamos bundles/add-ons aquí (raw + tags ya en memoria) y los
  // incluimos en el row del upsert. Antes esto corría como UPDATE
  // separado por cada producto post-sync — N+1 que timeout-eaba en
  // stores con 500+ SKUs.
  const bundle = detectBundleApp(
    p as Parameters<typeof detectBundleApp>[0],
    tags,
  )
  return {
    user_id: args.userId,
    workspace_id: args.workspaceId,
    shop_domain: args.shopDomain,
    platform: 'shopify',
    external_id: p.id,
    handle: p.handle,
    title: p.title,
    description: stripHtml(p.body_html ?? ''),
    product_type: p.product_type ?? null,
    vendor: p.vendor ?? null,
    tags,
    price_min: min,
    price_max: max,
    currency: shopCurrency,
    image_url: p.image?.src ?? p.images?.[0]?.src ?? null,
    url: `https://${dominioPublico || args.shopDomain}/products/${p.handle}`,
    is_bundle: bundle.isBundle,
    bundle_app: bundle.app,
    bundle_metadata: bundle.metadata,
    raw: p,
    synced_at: new Date().toISOString(),
  }
}

/** Strip HTML tags + collapse whitespace. Good enough for AI context;
 *  we don't need a full DOM parser here. */
function stripHtml(html: string): string {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)
}
