import type { SupabaseClient } from '@supabase/supabase-js'
import { persistShopifyConnection } from '@/lib/shopify/connection'
import { ShopifyAdminClient } from '@/lib/shopify/admin-client'
import { syncShopifyProducts } from '@/lib/shopify/product-sync'
import { learnOffersOnConnect } from '@/lib/shopify/offer-learning'
import { enrichProducts } from '@/lib/products/enrich'
import { unificarLoObvio } from '@/lib/products/unify'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('shopify.complete')

/**
 * Everything that happens after we hold a valid OAuth access token and
 * know which workspace owns it: persist (encrypted), register webhooks,
 * kick off the background catalog sync → offer learning → enrichment
 * chain. Shared by the OAuth callback (session present at install time)
 * and the pending-install claim endpoint (App Store flow: install first,
 * sign in later).
 *
 * Never throws for webhook/sync problems — the connection itself is the
 * only fatal step. Background work is fire-and-forget by design.
 */
export async function completeShopifyConnection(
  admin: SupabaseClient,
  args: {
    userId: string
    workspaceId: string
    shopDomain: string
    accessToken: string
    scope: string | null
    /** Base URL for webhook callbacks (NEXT_PUBLIC_SITE_URL or request origin). */
    callbackBase: string
    /** Shop name if already known (claim flow); resolved best-effort otherwise. */
    shopName?: string | null
    /** Vida del token y con qué renovarlo (migración 194). Shopify dio de baja
     *  los que no expiran, así que esto viaja desde el canje hasta la fila. */
    expiresIn?: number | null
    refreshToken?: string | null
    refreshTokenExpiresIn?: number | null
  },
): Promise<void> {
  const { userId, workspaceId, shopDomain, accessToken, scope } = args
  const client = new ShopifyAdminClient(shopDomain, accessToken)

  let shopName = args.shopName ?? null
  if (!shopName) {
    try {
      shopName = (await client.getShopInfo()).name || null
    } catch (err) {
      log.warn('shop_info_failed', {
        shop: shopDomain,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  await persistShopifyConnection(admin, {
    expiresIn: args.expiresIn,
    refreshToken: args.refreshToken,
    refreshTokenExpiresIn: args.refreshTokenExpiresIn,
    userId,
    workspaceId,
    shopDomain,
    shopName,
    accessToken,
    scope,
    // Mark the connection authoritatively as OAuth so webhook verification
    // uses the global secret even if this shop was previously admin_token.
    connectionMethod: 'oauth',
  })

  try {
    await client.registerWebhooks(args.callbackBase)
  } catch (err) {
    // Non-fatal — the connection is persisted; registration can be retried.
    log.error('webhook_register_failed', {
      shop: shopDomain,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Background-sync the catalog so the AI has something to reason about
  // immediately, then learn offer tiers from order history, then enrich
  // (scrape + research). Chained fire-and-forget; never blocks the caller.
  const enrichOnConnect = process.env.SHOPIFY_ENRICH_ON_CONNECT !== '0'
  const enrichMax = Math.max(
    1,
    Math.min(Number(process.env.SHOPIFY_ENRICH_MAX) || 25, 200),
  )
  syncShopifyProducts(admin, {
    userId,
    workspaceId,
    shopDomain,
    accessToken,
  })
    .then(() =>
      learnOffersOnConnect(admin, {
        shopDomain,
        accessToken,
        maxPages: 2,
        locale: 'es',
      }),
    )
    .then(() =>
      enrichOnConnect
        ? enrichProducts(admin, { shopDomain, max: enrichMax, locale: 'es' })
        : undefined,
    )
    // Si esta tienda es el segundo canal del mismo catálogo, se pliega contra
    // el que ya estaba: el conocimiento se carga una vez y vale para los dos.
    .then(() => (workspaceId ? unificarLoObvio(admin, workspaceId) : undefined))
    .catch((err) =>
      log.error('initial_sync_offer_or_enrich_failed', {
        shop: shopDomain,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
}
