import type { SupabaseClient } from '@supabase/supabase-js'
import { detectBundleApp } from '@/lib/products/bundle-detection'
import type { CommercePlatform, NormalizedProduct } from './types'

/**
 * Escritura del catálogo en `shopify_products`, común a las tres
 * plataformas.
 *
 * La tabla es UNA sola a propósito: el agente, la página de Productos,
 * los flujos y la búsqueda de productos ya leen de ahí, así que una
 * tienda de Tiendanube o WooCommerce queda disponible para todo eso sin
 * tocar ningún consumidor. `platform` solo marca el origen.
 *
 * El upsert va por (shop_domain, external_id), que es la constraint que
 * existe desde la migración 025, así que re-sincronizar refresca precios
 * y descripciones en su lugar: no duplica filas y los vínculos
 * agente↔producto (`ai_agent_products`) siguen apuntando a lo mismo.
 */
export async function upsertCatalog(
  db: SupabaseClient,
  args: {
    platform: CommercePlatform
    userId: string
    workspaceId: string
    shopDomain: string
    currency: string | null
    products: NormalizedProduct[]
  },
): Promise<{ synced: number; deleted: number; bundlesDetected: number }> {
  if (args.products.length === 0) {
    // Sin productos NO borramos nada. Un sync que devuelve vacío es casi
    // siempre un fallo de credencial o de permisos, no una tienda que se
    // quedó sin catálogo: vaciar la tabla dejaría al agente sin nada que
    // vender hasta el próximo sync exitoso.
    return { synced: 0, deleted: 0, bundlesDetected: 0 }
  }

  const rows = args.products.map((p) => {
    const bundle = detectBundleApp(
      {
        title: p.title,
        product_type: p.productType ?? undefined,
        tags: p.tags,
      },
      p.tags,
    )
    return {
      user_id: args.userId,
      workspace_id: args.workspaceId,
      platform: args.platform,
      shop_domain: args.shopDomain,
      external_id: p.externalId,
      handle: p.handle,
      title: p.title,
      description: p.description,
      product_type: p.productType,
      vendor: p.vendor,
      tags: p.tags,
      price_min: p.priceMin,
      price_max: p.priceMax,
      currency: args.currency,
      image_url: p.imageUrl,
      url: p.url,
      is_bundle: bundle.isBundle,
      bundle_app: bundle.app,
      bundle_metadata: bundle.metadata,
      raw: p.raw,
      synced_at: new Date().toISOString(),
    }
  })

  const bundlesDetected = rows.filter((r) => r.is_bundle).length

  // PostgREST corta el payload de la request; 200 filas por chunk es el
  // mismo tamaño que usa el sync de Shopify y aguanta descripciones largas.
  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from('shopify_products')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'shop_domain,external_id' })
    if (error) {
      throw new Error(`Alta de catálogo (${args.platform}) falló: ${error.message}`)
    }
  }

  // Barremos lo que ya no está en la tienda, acotado a ESTA tienda y
  // plataforma para no tocar el catálogo de otra conectada en paralelo.
  const present = new Set(args.products.map((p) => p.externalId))
  const { data: existing } = await db
    .from('shopify_products')
    .select('id, external_id')
    .eq('platform', args.platform)
    .eq('shop_domain', args.shopDomain)
  const stale = ((existing ?? []) as { id: string; external_id: number }[])
    .filter((row) => !present.has(Number(row.external_id)))
    .map((row) => row.id)
  if (stale.length > 0) {
    await db.from('shopify_products').delete().in('id', stale)
  }

  return { synced: rows.length, deleted: stale.length, bundlesDetected }
}
