import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import {
  normalizeShopDomain,
  buildAuthorizeUrl,
  shopifyRedirectUri,
  shopifyScopes,
} from '@/lib/shopify/oauth'
import {
  appQueFirmo,
  appsGlobales,
  appsParaLaTienda,
  type AppDeShopify,
} from '@/lib/shopify/apps-del-comercio'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getConnectionByShop } from '@/lib/shopify/connection'
import { hasPendingInstall } from '@/lib/shopify/pending-install'
import { getLocale } from '@/lib/i18n/server'
import { localizePath } from '@/lib/i18n/routes'
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

  const url = new URL(request.url)
  const shop = normalizeShopDomain(url.searchParams.get('shop') || '')
  if (!shop) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.invalidShopDomain') },
      { status: 400 },
    )
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin

  // Shopify-initiated hits (App URL bootstrap) arrive signed, and the
  // signature tells us WHICH app is being installed or opened: the public
  // one, the legacy custom-distribution one, or a merchant's own app
  // (migration 275), all sharing the App URL. A forged/tampered query
  // verifies against none of them and never starts OAuth.
  let app: AppDeShopify | null
  if (url.searchParams.get('hmac')) {
    app = appQueFirmo(await appsParaLaTienda(supabaseAdmin(), shop), url.searchParams)
    if (!app) {
      // Also what the owner sees when a merchant app gets installed before
      // anyone saved its credentials in Riverz.
      const aviso = new URL('/shopify/instalada', base)
      aviso.searchParams.set('estado', 'error')
      return NextResponse.redirect(aviso)
    }
  } else {
    // Unsigned, app-initiated start: always the public app.
    app = appsGlobales().find((a) => a.apiKey === process.env.SHOPIFY_API_KEY) ?? null
  }
  if (!app) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.shopifyNotConfigured') },
      { status: 503 },
    )
  }

  // Shopify loads the App URL (which the proxy forwards here) both to START
  // an install AND to OPEN an already-installed app. If we bounce an already
  // installed shop back to the OAuth grant, Shopify aborts the load with
  // `application_cant_be_loaded_misconfigured`. So when the shop is already
  // connected — or has an unclaimed pending install from a just-completed
  // OAuth round-trip — send the merchant INTO the app instead of re-running
  // OAuth: sign in to the workspace that owns it, or claim the pending store.
  //
  // A merchant app is not embedded and opens top-level, so re-running OAuth
  // is harmless there: it refreshes the connection and shows the owner the
  // confirmation page.
  if (!app.destino) {
    try {
      const admin = supabaseAdmin()
      if (await getConnectionByShop(admin, shop)) {
        return NextResponse.redirect(new URL(localizePath('/ingresar', locale), base))
      }
      if (await hasPendingInstall(admin, shop)) {
        // Hay una instalacion estacionada: el comercio crea su cuenta y el
        // panel reclama la tienda solo. La cookie de reclamo le abre /crear
        // aunque el alta publica este cerrada.
        const claimUrl = new URL(
          localizePath('/crear', locale),
          base,
        )
        claimUrl.searchParams.set('shopify', 'pending')
        claimUrl.searchParams.set('shop', shop)
        return NextResponse.redirect(claimUrl)
      }
    } catch {
      // Lookup failed — fall through to OAuth so a fresh install still works.
    }
  }

  const redirectUri = shopifyRedirectUri()

  const state = randomBytes(32).toString('hex')
  const authorizeUrl = buildAuthorizeUrl({
    shop,
    state,
    apiKey: app.apiKey,
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
