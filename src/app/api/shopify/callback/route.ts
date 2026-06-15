import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  normalizeShopDomain,
  verifyOAuthHmac,
  exchangeCodeForToken,
} from '@/lib/shopify/oauth'
import { persistShopifyConnection } from '@/lib/shopify/connection'
import { ShopifyAdminClient } from '@/lib/shopify/admin-client'
import { syncShopifyProducts } from '@/lib/shopify/product-sync'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('shopify.callback')

/**
 * Complete Shopify OAuth: verify HMAC + state + shop, exchange the code for
 * a token, persist (encrypted), register webhooks, then bounce back to
 * Settings. Mirrors the Riverz callback, adapted to Supabase (no Clerk) and
 * this app's single-string encryption.
 *
 * This callback supports TWO install flows:
 *
 *  (a) App-initiated (our /api/shopify/install endpoint).
 *      The user is signed in to our app, /install set httpOnly cookies
 *      (`shopify_oauth_state`, `shopify_oauth_shop`, `shopify_oauth_user`),
 *      and we validate the CSRF `state` round-trip + bind the OAuth result
 *      to the authenticated user via the user-id cookie.
 *
 *  (b) Shopify-initiated custom-app distribution.
 *      The merchant clicks "Install" inside admin.shopify.com and is
 *      redirected straight to this callback with NO cookies on the
 *      request. There is no state to validate (we never issued one) and
 *      no user-id cookie to bind to.
 *
 *      Skipping the state check in flow (b) is safe because Shopify signs
 *      every callback query string with an HMAC of (shared secret, params).
 *      `verifyOAuthHmac` is the authoritative security gate: if the HMAC
 *      verifies, the `shop`, `code`, and `timestamp` params came from
 *      Shopify and were not tampered with. State is an extra CSRF guard
 *      for browser-initiated flows we kicked off ourselves; when Shopify
 *      itself is the initiator there is no CSRF surface to defend.
 *
 *      For ownership, flow (b) falls back to (in order):
 *        1. `SHOPIFY_DEFAULT_OWNER_ID` env var, then
 *        2. the oldest `auth.users` row (workspace owner / Pilar).
 *      A warning is logged so the install can be reassigned later if
 *      multi-tenant.
 */
function bounce(request: Request, params: Record<string, string>): NextResponse {
  const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
  const url = new URL('/integraciones', base)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

/**
 * Resolve the user_id to bind a Shopify connection to.
 *
 *  1. cookie set by /install (the authenticated installer)
 *  2. SHOPIFY_DEFAULT_OWNER_ID env var (ops override)
 *  3. oldest auth.users row — the workspace owner
 */
async function resolveOwnerUserId(
  cookieUserId: string | undefined,
  shop: string,
): Promise<string | null> {
  if (cookieUserId) return cookieUserId

  const envOwner = process.env.SHOPIFY_DEFAULT_OWNER_ID?.trim()
  if (envOwner) {
    log.info('owner_resolved_from_env', { shop, userId: envOwner })
    return envOwner
  }

  try {
    const admin = supabaseAdmin()
    // auth.users is not in the public schema; go through the auth admin API.
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    })
    if (error) {
      log.error('owner_lookup_failed', { shop, error: error.message })
      return null
    }
    const users = data?.users ?? []
    // listUsers returns newest-first; pick the oldest to get the founding owner.
    const oldest = [...users].sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0
      const tb = b.created_at ? Date.parse(b.created_at) : 0
      return ta - tb
    })[0]
    if (!oldest) {
      log.error('owner_lookup_empty', { shop })
      return null
    }
    log.warn(
      "Shopify install assigned to default owner — Pilar's installation needs reassignment if multi-tenant.",
      { shop, userId: oldest.id },
    )
    return oldest.id
  } catch (err) {
    log.error('owner_lookup_threw', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const apiKey = process.env.SHOPIFY_API_KEY
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiKey || !apiSecret) {
    log.error('not_configured', {})
    return bounce(request, { shopify: 'error', reason: 'not_configured' })
  }

  // 1. HMAC over the query string. This is the security gate for BOTH flows.
  if (!verifyOAuthHmac(params, apiSecret)) {
    log.error('hmac_failed', { shop: params.get('shop') })
    return bounce(request, { shopify: 'error', reason: 'hmac' })
  }

  // 2. Pull cookies (may all be empty in the Shopify-initiated flow).
  const jar = await cookies()
  const expectedState = jar.get('shopify_oauth_state')?.value
  const expectedShop = jar.get('shopify_oauth_shop')?.value
  const cookieUserId = jar.get('shopify_oauth_user')?.value

  const state = params.get('state') ?? ''
  const shop = normalizeShopDomain(params.get('shop') || '')
  const code = params.get('code')

  if (!shop) {
    log.error('bad_shop_param', { shop: params.get('shop') })
    return bounce(request, { shopify: 'error', reason: 'bad_shop' })
  }
  if (!code) {
    log.error('no_code', { shop })
    return bounce(request, { shopify: 'error', reason: 'no_code' })
  }

  // 3. Branch on whether this is our /install round-trip or a custom-app
  //    distribution install kicked off from admin.shopify.com.
  const isAppInitiated = Boolean(expectedState)

  if (isAppInitiated) {
    // Flow (a) — strict checks.
    if (!state || state !== expectedState) {
      log.error('state_mismatch', { shop, hasState: Boolean(state) })
      return bounce(request, {
        shopify: 'error',
        reason: 'state',
        shop,
      })
    }
    if (expectedShop && shop !== expectedShop) {
      log.error('shop_mismatch', { shop, expectedShop })
      return bounce(request, {
        shopify: 'error',
        reason: 'bad_shop',
        shop,
      })
    }
  } else {
    // Flow (b) — Shopify-initiated. State is absent (we never issued one).
    // If the caller sent a `state` query param anyway, that's unusual — refuse
    // rather than silently accept, so we can spot a misconfigured install.
    if (state) {
      log.error('state_with_custom_install', { shop })
      return bounce(request, {
        shopify: 'error',
        reason: 'state_with_custom_install',
        shop,
      })
    }
    log.info('custom_app_distribution_install', {
      shop,
      userId: null,
      scope: params.get('scope') ?? null,
    })
  }

  // 4. Resolve which user owns this connection.
  const userId = await resolveOwnerUserId(cookieUserId, shop)
  if (!userId) {
    log.error('no_user_resolved', { shop })
    return bounce(request, {
      shopify: 'error',
      reason: 'no_user',
      shop,
    })
  }

  try {
    // 5. Exchange code → token.
    const { access_token, scope } = await exchangeCodeForToken({
      shop,
      code,
      apiKey,
      apiSecret,
    })

    // 6. Resolve shop name (best-effort) + persist (service role).
    const client = new ShopifyAdminClient(shop, access_token)
    let shopName: string | null = null
    try {
      shopName = (await client.getShopInfo()).name || null
    } catch (err) {
      log.warn('shop_info_failed', {
        shop,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    const admin = supabaseAdmin()
    await persistShopifyConnection(admin, {
      userId,
      shopDomain: shop,
      shopName,
      accessToken: access_token,
      scope,
    })

    // 7. Register webhooks (abandoned checkout + app/uninstalled).
    const callbackBase =
      process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
    try {
      await client.registerWebhooks(callbackBase)
    } catch (err) {
      // Non-fatal — log and continue. The connection is already persisted,
      // and webhook registration can be retried out-of-band.
      log.error('webhook_register_failed', {
        shop,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // 8. Background-sync the product catalog so the AI assistant has
    //    something to reason about immediately. Fire-and-forget — never
    //    block the OAuth redirect on a 5 s catalog scan.
    syncShopifyProducts(admin, {
      userId,
      shopDomain: shop,
      accessToken: access_token,
    }).catch((err) =>
      log.error('initial_product_sync_failed', {
        shop,
        error: err instanceof Error ? err.message : String(err),
      }),
    )

    log.info('install_success', {
      shop,
      userId,
      scope,
      flow: isAppInitiated ? 'app_initiated' : 'custom_app_distribution',
    })

    const res = bounce(request, { shopify: 'connected', shop })
    res.cookies.delete('shopify_oauth_state')
    res.cookies.delete('shopify_oauth_user')
    res.cookies.delete('shopify_oauth_shop')
    return res
  } catch (err) {
    log.error('exchange_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    })
    return bounce(request, {
      shopify: 'error',
      reason: 'exchange',
      shop,
    })
  }
}
