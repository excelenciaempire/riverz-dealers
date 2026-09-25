import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  normalizeShopDomain,
  exchangeCodeForToken,
} from '@/lib/shopify/oauth'
import {
  appQueFirmo,
  appsGlobales,
  appsParaLaTienda,
} from '@/lib/shopify/apps-del-comercio'
import { completeShopifyConnection } from '@/lib/shopify/complete-connection'
import {
  createPendingInstall,
  CLAIM_COOKIE,
  CLAIM_HINT_COOKIE,
} from '@/lib/shopify/pending-install'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('shopify.callback')

/**
 * Complete Shopify OAuth: verify HMAC + state + shop, exchange the code for
 * a token, then either bind it to the installer's workspace or park it as a
 * pending install. This callback supports THREE install flows:
 *
 *  (a) App-initiated (our /api/shopify/install endpoint).
 *      The user is signed in to our app, /install set httpOnly cookies
 *      (`shopify_oauth_state`, `shopify_oauth_shop`, `shopify_oauth_user`,
 *      `shopify_oauth_workspace`), and we validate the CSRF `state`
 *      round-trip + bind the OAuth result to the authenticated user.
 *
 *  (b) Shopify-initiated with a resolvable owner.
 *      The merchant clicks "Install"/"Open" inside admin.shopify.com and
 *      lands here with no cookies. There is no state to validate (we never
 *      issued one — the /oauth/start bootstrap sets its own) and no user
 *      cookie. Ownership falls back to SHOPIFY_DEFAULT_OWNER_ID or the
 *      newest prior connection for the shop (reinstall case).
 *
 *      Skipping the state check here is safe because Shopify signs every
 *      callback query string: `verifyOAuthHmac` is the authoritative
 *      security gate. State is an extra CSRF guard for flows we kicked off
 *      ourselves; when Shopify is the initiator there is no CSRF surface.
 *
 *  (c) Shopify-initiated, brand-new merchant (App Store install).
 *      No session, no env override, no prior connection. The App Store
 *      requires OAuth to run BEFORE any Riverz login, so we exchange the
 *      code, park the encrypted token in `shopify_pending_installs`, hand
 *      the browser a single-use claim cookie, and return the merchant to the
 *      embedded Shopify app. The embedded page then offers the Riverz sign-in
 *      needed to claim the store (POST /api/shopify/claim).
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
 *  3. newest prior connection for this shop (cookie-less reinstall)
 *
 * Returns null for a brand-new Shopify-initiated install — the caller
 * then takes the pending-install path instead of failing.
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
    const { data: existing } = await admin
      .from('shopify_connections')
      .select('user_id')
      .eq('platform', 'shopify')
      .eq('shop_domain', shop)
      .order('installed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing?.user_id) {
      log.info('owner_resolved_from_existing_connection', {
        shop,
        userId: existing.user_id,
      })
      return existing.user_id
    }
  } catch (err) {
    log.warn('owner_existing_lookup_threw', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return null
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const admin = supabaseAdmin()
  // Several app identities can sign this callback: the public "Riverz" app,
  // the legacy custom-distribution app, and each merchant's own app
  // (migration 275). The HMAC tells us which one signed it, and the code
  // exchange MUST use that same app's credentials. The shop param is only
  // used to find candidate secrets; nothing is trusted until one verifies.
  const shopParam = normalizeShopDomain(params.get('shop') || '')
  const pairs = shopParam
    ? await appsParaLaTienda(admin, shopParam)
    : appsGlobales()
  if (!pairs.length) {
    log.error('not_configured', {})
    return bounce(request, { shopify: 'error', reason: 'not_configured' })
  }

  // 1. HMAC over the query string. This is the security gate for ALL flows.
  const pair = appQueFirmo(pairs, params)
  if (!pair) {
    // Solo diagnóstico NO sensible. No recomputamos ni logueamos el HMAC, el
    // mensaje firmado, el raw_query ni fragmento/longitud del secreto —
    // filtraría material sensible a stdout/Sentry.
    log.error('hmac_failed', {
      shop: params.get('shop'),
      param_keys: [...params.keys()],
    })
    return bounce(request, { shopify: 'error', reason: 'hmac' })
  }

  // 2. Pull cookies (may all be empty in the Shopify-initiated flow).
  const jar = await cookies()
  const expectedState = jar.get('shopify_oauth_state')?.value
  const expectedShop = jar.get('shopify_oauth_shop')?.value
  const cookieUserId = jar.get('shopify_oauth_user')?.value
  const cookieWorkspaceId = jar.get('shopify_oauth_workspace')?.value

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

  // 3. Branch on whether this is our /install round-trip or a Shopify-
  //    initiated install (App Store / admin / custom-app distribution).
  const isAppInitiated = Boolean(expectedState)

  if (isAppInitiated) {
    // Flow (a) — strict checks.
    if (!state || state !== expectedState) {
      log.error('state_mismatch', { shop, hasState: Boolean(state) })
      return bounce(request, { shopify: 'error', reason: 'state', shop })
    }
    if (expectedShop && shop !== expectedShop) {
      log.error('shop_mismatch', { shop, expectedShop })
      return bounce(request, { shopify: 'error', reason: 'bad_shop', shop })
    }
  } else {
    // Flows (b)/(c). The /oauth/start bootstrap issues its own state cookie;
    // if it's absent AND the caller still sent a `state` param, that's a
    // misconfigured install — refuse rather than silently accept.
    if (state) {
      log.error('state_with_custom_install', { shop })
      return bounce(request, {
        shopify: 'error',
        reason: 'state_with_custom_install',
        shop,
      })
    }
    log.info('shopify_initiated_install', {
      shop,
      scope: params.get('scope') ?? null,
    })
  }

  // 4. Exchange code → token FIRST. The single-use code must be consumed
  //    on every path (binding or pending) or the install dead-ends.
  let accessToken: string
  let grantedScope: string
  // El token ahora vence y trae con qué renovarlo. Sin guardar las dos cosas,
  // la tienda deja de contestar en una hora.
  let expiresIn: number | null = null
  let refreshToken: string | null = null
  let refreshExpiresIn: number | null = null
  try {
    const exchanged = await exchangeCodeForToken({
      shop,
      code,
      apiKey: pair.apiKey,
      apiSecret: pair.apiSecret,
    })
    accessToken = exchanged.access_token
    grantedScope = exchanged.scope
    expiresIn = exchanged.expires_in
    refreshToken = exchanged.refresh_token
    refreshExpiresIn = exchanged.refresh_token_expires_in
  } catch (err) {
    log.error('exchange_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    })
    return bounce(request, { shopify: 'error', reason: 'exchange', shop })
  }

  const callbackBase =
    process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin

  // 5. Resolve which user/workspace owns this connection. A merchant's own
  //    app was registered from a workspace, and that registration decides:
  //    the owner who installs it usually has no Riverz session at all.
  const userId =
    pair.destino?.userId ?? (await resolveOwnerUserId(cookieUserId, shop))
  const workspaceId =
    pair.destino?.workspaceId ??
    (userId
      ? cookieWorkspaceId || (await resolveWorkspaceIdForUser(admin, userId))
      : null)

  // 5b. Flow (c): brand-new merchant with no Riverz identity. Park the
  //     token and send them to create/sign into an account; the dashboard
  //     claims the store right after auth.
  if (!userId || !workspaceId) {
    try {
      const { claimToken } = await createPendingInstall(admin, {
        shopDomain: shop,
        accessToken,
        scope: grantedScope,
        clientId: pair.apiKey,
      })
      log.info('install_parked_pending_claim', { shop })

      // Return to the embedded app immediately after Shopify authentication.
      // The App Store checker requires this handoff; the embedded page shows
      // the Riverz account-link action while the encrypted install is parked.
      const shopHandle = shop.slice(0, -'.myshopify.com'.length)
      const url = new URL(
        `/store/${encodeURIComponent(shopHandle)}/apps/${encodeURIComponent(pair.apiKey)}`,
        'https://admin.shopify.com',
      )
      const res = NextResponse.redirect(url)
      const cookieOpts = {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        maxAge: 24 * 60 * 60,
        path: '/',
      }
      res.cookies.set(CLAIM_COOKIE, claimToken, { ...cookieOpts, httpOnly: true })
      // JS-readable hint (domain only, no secret) so the dashboard knows
      // to auto-claim after sign-in.
      res.cookies.set(CLAIM_HINT_COOKIE, shop, { ...cookieOpts, httpOnly: false })
      return res
    } catch (err) {
      log.error('pending_install_failed', {
        shop,
        error: err instanceof Error ? err.message : String(err),
      })
      return bounce(request, { shopify: 'error', reason: 'pending', shop })
    }
  }

  // 6. Flows (a)/(b): bind now — persist, register webhooks, kick off the
  //    background catalog sync chain.
  try {
    await completeShopifyConnection(admin, {
      userId,
      workspaceId,
      shopDomain: shop,
      accessToken,
      scope: grantedScope,
      clientId: pair.apiKey,
      callbackBase,
      expiresIn,
      refreshToken,
      refreshTokenExpiresIn: refreshExpiresIn,
      // Its token renews and its webhooks verify with ITS secret.
      ...(pair.destino
        ? { connectionMethod: 'custom_app' as const, webhookSecret: pair.apiSecret }
        : {}),
    })

    log.info('install_success', {
      shop,
      userId,
      scope: grantedScope,
      flow: isAppInitiated ? 'app_initiated' : 'shopify_initiated',
      customApp: Boolean(pair.destino),
    })

    // The owner who installed a merchant app usually has no Riverz account:
    // show a confirmation instead of the Riverz login.
    const res = pair.destino
      ? NextResponse.redirect(new URL('/shopify/instalada', callbackBase))
      : bounce(request, { shopify: 'connected', shop })
    res.cookies.delete('shopify_oauth_state')
    res.cookies.delete('shopify_oauth_user')
    res.cookies.delete('shopify_oauth_workspace')
    res.cookies.delete('shopify_oauth_shop')
    return res
  } catch (err) {
    log.error('persist_failed', {
      shop,
      error: err instanceof Error ? err.message : String(err),
    })
    return bounce(request, { shopify: 'error', reason: 'exchange', shop })
  }
}
