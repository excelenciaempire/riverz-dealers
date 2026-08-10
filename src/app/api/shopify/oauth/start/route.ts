import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import {
  normalizeShopDomain,
  buildAuthorizeUrl,
  shopifyScopes,
  verifyOAuthHmac,
} from '@/lib/shopify/oauth'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { hasPendingInstall } from '@/lib/shopify/pending-install'
import { getLocale } from '@/lib/i18n/server'
import { localizePath } from '@/lib/i18n/routes'
import { translate } from '@/lib/i18n/translate'
import { signupsOpen } from '@/lib/auth/signups'

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

  // Shopify loads the App URL (which the proxy forwards here) both to START
  // an install AND to OPEN an already-installed app. If we bounce an already
  // installed shop back to the OAuth grant, Shopify aborts the load with
  // `application_cant_be_loaded_misconfigured`. So when the shop is already
  // connected — or has an unclaimed pending install from a just-completed
  // OAuth round-trip — send the merchant INTO the app instead of re-running
  // OAuth: sign in to the workspace that owns it, or claim the pending store.
  const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
  try {
    const admin = supabaseAdmin()
    if (await getConnectionByShop(admin, shop)) {
      return NextResponse.redirect(new URL(localizePath('/ingresar', locale), base))
    }
    if (await hasPendingInstall(admin, shop)) {
      // Pre-launch: /registro is closed — the merchant signs in and the
      // dashboard auto-claims the parked install.
      const claimUrl = new URL(
        localizePath(signupsOpen() ? '/registro' : '/ingresar', locale),
        base,
      )
      claimUrl.searchParams.set('shopify', 'pending')
      claimUrl.searchParams.set('shop', shop)
      return NextResponse.redirect(claimUrl)
    }
  } catch {
    // Lookup failed — fall through to OAuth so a fresh install still works.
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
