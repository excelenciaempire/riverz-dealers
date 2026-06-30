import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { normalizeShopDomain } from '@/lib/shopify/oauth'
import { persistShopifyConnection } from '@/lib/shopify/connection'
import { ShopifyAdminClient } from '@/lib/shopify/admin-client'
import { syncShopifyProducts } from '@/lib/shopify/product-sync'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('shopify.connect-token')

/**
 * Connect a Shopify store via a CUSTOM APP the merchant created in their
 * own Shopify admin (Settings → Apps and sales channels → Develop apps),
 * pasting the Admin API access token + API secret key. No OAuth, no global
 * SHOPIFY_API_KEY — the connection is fully self-contained per workspace,
 * so a handful of high-ticket merchants can be onboarded white-glove
 * without an App Store review.
 *
 * Differences from the OAuth callback:
 *  - The token is provided directly (no code exchange).
 *  - We persist the per-store `webhook_secret` (the app's API secret key) so
 *    this store's webhooks verify against IT, not the global secret.
 *  - `connection_method = 'admin_token'`.
 *
 * The token is validated by actually calling the Admin API (/shop.json):
 * a bad token or wrong domain fails here instead of silently connecting a
 * dead store.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  const locale = await getLocale()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { shop?: string; accessToken?: string; apiSecret?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    body = {}
  }

  const shop = normalizeShopDomain(body.shop ?? '')
  const accessToken = (body.accessToken ?? '').trim()
  const apiSecret = (body.apiSecret ?? '').trim()

  if (!shop) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.invalidShopDomain') },
      { status: 400 },
    )
  }
  if (!accessToken || !apiSecret) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyMissingTokenFields') },
      { status: 400 },
    )
  }

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.noWorkspaceForUser') },
      { status: 400 },
    )
  }

  // Validate the token against the live store before persisting anything.
  const client = new ShopifyAdminClient(shop, accessToken)
  let shopName: string | null = null
  try {
    shopName = (await client.getShopInfo()).name || null
  } catch (err) {
    log.warn('token_validation_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyTokenInvalid') },
      { status: 400 },
    )
  }

  const admin = supabaseAdmin()
  try {
    await persistShopifyConnection(admin, {
      userId: user.id,
      workspaceId,
      shopDomain: shop,
      shopName,
      accessToken,
      // No OAuth grant string — actual permissions are whatever the merchant
      // granted when creating the custom app; the AI's create_order tool
      // derives "missing write scope" from the live 401/403, not from this.
      scope: null,
      webhookSecret: apiSecret,
      connectionMethod: 'admin_token',
    })
  } catch (err) {
    log.error('persist_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyTokenInvalid') },
      { status: 500 },
    )
  }

  // Register the abandoned-checkout / order / uninstall webhooks. Best-effort
  // — the connection is already saved and Shopify dedupes by (topic, address)
  // so this is safely retryable. Webhooks created here are HMAC-signed with
  // the custom app's API secret key (the webhook_secret we just stored).
  const callbackBase =
    process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
  try {
    await client.registerWebhooks(callbackBase)
  } catch (err) {
    log.error('webhook_register_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Background catalog sync so the AI assistant has products to reason about
  // immediately. Fire-and-forget — never block the response on it.
  syncShopifyProducts(admin, {
    userId: user.id,
    workspaceId,
    shopDomain: shop,
    accessToken,
  }).catch((err) =>
    log.error('initial_product_sync_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    }),
  )

  log.info('connect_token_success', { shop, userId: user.id, workspaceId })
  return NextResponse.json({ ok: true, shop_domain: shop, shop_name: shopName })
}
