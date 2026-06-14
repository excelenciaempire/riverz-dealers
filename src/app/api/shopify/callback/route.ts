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

/**
 * Complete Shopify OAuth: verify HMAC + state + shop, exchange the code for
 * a token, persist (encrypted), register webhooks, then bounce back to
 * Settings. Mirrors the Riverz callback, adapted to Supabase (no Clerk) and
 * this app's single-string encryption.
 */
function bounce(request: Request, params: Record<string, string>): NextResponse {
  const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
  const url = new URL('/integraciones', base)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const apiKey = process.env.SHOPIFY_API_KEY
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiKey || !apiSecret) {
    return bounce(request, { shopify: 'error', reason: 'not_configured' })
  }

  // 1. HMAC over the query string.
  if (!verifyOAuthHmac(params, apiSecret)) {
    return bounce(request, { shopify: 'error', reason: 'hmac' })
  }

  // 2. State + shop must match what we set at install time.
  const jar = await cookies()
  const expectedState = jar.get('shopify_oauth_state')?.value
  const expectedShop = jar.get('shopify_oauth_shop')?.value
  const userId = jar.get('shopify_oauth_user')?.value

  const state = params.get('state')
  if (!state || !expectedState || state !== expectedState) {
    return bounce(request, { shopify: 'error', reason: 'state' })
  }
  const shop = normalizeShopDomain(params.get('shop') || '')
  if (!shop || shop !== expectedShop) {
    return bounce(request, { shopify: 'error', reason: 'bad_shop' })
  }
  if (!userId) {
    return bounce(request, { shopify: 'error', reason: 'no_user' })
  }
  const code = params.get('code')
  if (!code) {
    return bounce(request, { shopify: 'error', reason: 'no_code' })
  }

  try {
    // 3. Exchange code → token.
    const { access_token, scope } = await exchangeCodeForToken({
      shop,
      code,
      apiKey,
      apiSecret,
    })

    // 4. Resolve shop name (best-effort) + persist (service role).
    const client = new ShopifyAdminClient(shop, access_token)
    let shopName: string | null = null
    try {
      shopName = (await client.getShopInfo()).name || null
    } catch {
      // non-fatal
    }

    const admin = supabaseAdmin()
    await persistShopifyConnection(admin, {
      userId,
      shopDomain: shop,
      shopName,
      accessToken: access_token,
      scope,
    })

    // 5. Register webhooks (abandoned checkout + app/uninstalled).
    const callbackBase =
      process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
    await client.registerWebhooks(callbackBase)

    // 6. Background-sync the product catalog so the AI assistant has
    //    something to reason about immediately. Fire-and-forget — never
    //    block the OAuth redirect on a 5 s catalog scan.
    syncShopifyProducts(admin, {
      userId,
      shopDomain: shop,
      accessToken: access_token,
    }).catch((err) =>
      console.error('[shopify] initial product sync failed:', err),
    )

    const res = bounce(request, { shopify: 'connected', shop })
    res.cookies.delete('shopify_oauth_state')
    res.cookies.delete('shopify_oauth_user')
    res.cookies.delete('shopify_oauth_shop')
    return res
  } catch (err) {
    console.error('[shopify] callback failed:', err)
    return bounce(request, { shopify: 'error', reason: 'exchange' })
  }
}
