import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import {
  normalizeShopDomain,
  buildAuthorizeUrl,
  shopifyScopes,
  verifyOAuthHmac,
} from '@/lib/shopify/oauth'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * Post-install bootstrap entrypoint. Shopify custom-app distribution
 * lands the merchant on the App URL (site root) with `?shop=…&hmac=…`
 * instead of hitting our redirect_uri directly. The proxy detects that
 * query param and forwards here so the merchant (who has no Riverz
 * session) can complete the OAuth code flow. The callback falls back to
 * SHOPIFY_DEFAULT_OWNER_ID / the oldest user when no session cookie is
 * present.
 */
export async function GET(request: Request) {
  const locale = await getLocale()

  const apiKey = process.env.SHOPIFY_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyNotConfigured') },
      { status: 503 },
    )
  }

  const url = new URL(request.url)
  const shop = normalizeShopDomain(url.searchParams.get('shop') || '')
  if (!shop) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.invalidShopDomain') },
      { status: 400 },
    )
  }

  // Shopify-initiated hits (App URL bootstrap) arrive signed. When the
  // signature is present, verify it — a forged/tampered query then fails
  // instead of silently starting OAuth for an attacker-chosen shop. Both
  // app identities share the App URL, so accept either secret (primary
  // public app / legacy custom-distribution app).
  const secrets = [
    process.env.SHOPIFY_API_SECRET,
    process.env.SHOPIFY_API_SECRET_LEGACY,
  ].filter((s): s is string => Boolean(s))
  if (url.searchParams.get('hmac') && secrets.length) {
    if (!secrets.some((s) => verifyOAuthHmac(url.searchParams, s))) {
      return NextResponse.json(
        { error: translate(locale, 'errProducts.invalidShopDomain') },
        { status: 400 },
      )
    }
  }

  const redirectUri =
    process.env.SHOPIFY_OAUTH_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_SITE_URL}/api/shopify/oauth/callback`

  const state = randomBytes(32).toString('hex')
  const authorizeUrl = buildAuthorizeUrl({
    shop,
    state,
    apiKey,
    redirectUri,
    scopes: shopifyScopes(),
  })

  const res = NextResponse.redirect(authorizeUrl)
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/',
  }
  res.cookies.set('shopify_oauth_state', state, cookieOpts)
  res.cookies.set('shopify_oauth_shop', shop, cookieOpts)
  return res
}
