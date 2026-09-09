import type { SupabaseClient } from '@supabase/supabase-js'

export function productPageUrl(url: string, variantId: unknown): string {
  const page = new URL(url)
  if (page.protocol !== 'https:') throw new Error('Invalid product page protocol')
  if (variantId != null && /^\d+$/.test(String(variantId))) {
    page.searchParams.set('variant', String(variantId))
  }
  return page.toString()
}

/** Resolve the first cart item against this merchant's catalog, never a guessed slug. */
export async function cartProductUrl(db: SupabaseClient, workspaceId: string, checkoutUrl: string): Promise<string | null> {
  if (!checkoutUrl) return null
  const { data: checkout, error } = await db.from('shopify_checkouts')
    .select('shop_domain,line_items').eq('workspace_id', workspaceId)
    .eq('abandoned_checkout_url', checkoutUrl).limit(1).maybeSingle()
  if (error) throw error
  const item = Array.isArray(checkout?.line_items) ? checkout.line_items[0] : null
  if (!item?.product_id) return null
  const { data: product, error: productError } = await db.from('shopify_products')
    .select('url').eq('workspace_id', workspaceId).eq('shop_domain', checkout!.shop_domain)
    .eq('external_id', item.product_id).maybeSingle()
  if (productError) throw productError
  return product?.url ? productPageUrl(product.url, item.variant_id) : null
}
