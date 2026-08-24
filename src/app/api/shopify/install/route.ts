import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeShopDomain,
  buildAuthorizeUrl,
  shopifyScopes,
} from '@/lib/shopify/oauth'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { publicBaseUrl } from '@/lib/base-url'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * Kick off Shopify OAuth. Requires a logged-in user; stores the user id +
 * resolved workspace id + shop + CSRF state in short-lived httpOnly
 * cookies, then redirects the browser to Shopify's consent screen.
 *
 * The workspace_id cookie is what binds the resulting connection to a
 * tenant after migration 055 — the callback no longer infers workspace
 * from owner_id, it reads this cookie.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    // Sobre el dominio público y no sobre `request.url`.
    //
    // Detrás del proxy de Render, `request.url` es la dirección INTERNA
    // (`https://localhost:10000/...`), así que esto mandaba a quien no había
    // iniciado sesión a `https://localhost:10000/ingresar` — un
    // ERR_CONNECTION_REFUSED en su navegador. Y es justo el camino de instalar
    // desde la tienda de aplicaciones de Shopify, donde nadie llega con la
    // sesión abierta: el comercio aprieta "instalar" y ve una página muerta.
    // Medido contra producción el 2026-08-24.
    return NextResponse.redirect(new URL('/ingresar', publicBaseUrl()))
  }

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

  // Resolve workspace at install time so the callback can persist it
  // verbatim — no second round-trip, no race if the user gains/loses a
  // workspace mid-flow.
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.noWorkspaceForUser') },
      { status: 400 },
    )
  }

  const redirectUri =
    process.env.SHOPIFY_OAUTH_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_SITE_URL}/api/shopify/callback`

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
    maxAge: 600, // 10 minutes
    path: '/',
  }
  res.cookies.set('shopify_oauth_state', state, cookieOpts)
  res.cookies.set('shopify_oauth_user', user.id, cookieOpts)
  res.cookies.set('shopify_oauth_workspace', workspaceId, cookieOpts)
  res.cookies.set('shopify_oauth_shop', shop, cookieOpts)
  return res
}
