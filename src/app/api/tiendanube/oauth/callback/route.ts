import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decodeState } from '@/lib/channels/oauth'
import { exchangeTiendanubeCode } from '@/lib/commerce/providers/tiendanube'
import { completeTiendanubeConnection } from '@/lib/commerce/setup'
import { createPendingInstall } from '@/lib/shopify/pending-install'
import {
  TN_CLAIM_COOKIE,
  TN_CLAIM_HINT_COOKIE,
} from '@/lib/commerce/tiendanube-claim-cookies'
import { getLocale } from '@/lib/i18n/server'
import { localizePath } from '@/lib/i18n/routes'
import { signupsOpen } from '@/lib/auth/signups'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('tiendanube.callback')

/**
 * GET /api/tiendanube/oauth/callback?code=…&state=…
 *
 * Cierra la instalación: canjea el código, lee los datos de la tienda,
 * guarda la conexión, registra webhooks y trae el catálogo.
 *
 * Soporta los DOS orígenes de instalación, que no son intercambiables:
 *
 *  (a) Desde Riverz. Nuestro botón emitió un `state` firmado con el
 *      workspace y el usuario, así que la tienda se ata a quien la
 *      conectó aunque la sesión haya vencido durante el rodeo por el
 *      portal de Tiendanube.
 *
 *  (b) Desde Tiendanube. El comercio encuentra la app en la tienda de
 *      aplicaciones y la instala ANTES de tener cuenta en Riverz: no hay
 *      `state` que valgan porque nunca emitimos uno. Es el escenario que
 *      la homologación exige textualmente ("instalación de la app desde
 *      Nuvemshop y no desde el panel de la app") y hasta acá moría en
 *      `invalid_state`. Ahora el token se estaciona cifrado, el navegador
 *      se lleva un token de reclamo de un solo uso, y el panel ata la
 *      tienda al workspace en cuanto el comercio entra.
 *
 *      Si la tienda YA estuvo conectada (reinstalación), no hace falta
 *      pasar por el reclamo: se vuelve a atar a su dueño de siempre.
 *
 * El código de autorización es de un solo uso: se canjea en TODOS los
 * caminos, o la instalación queda muerta sin manera de reintentarla.
 */
function bounce(request: Request, params: Record<string, string>): NextResponse {
  const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
  const url = new URL('/integraciones', base)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const rawState = url.searchParams.get('state')

  if (!code) {
    return bounce(request, { tiendanube: 'error', reason: 'missing_code' })
  }

  const clientId = process.env.TIENDANUBE_APP_ID
  const clientSecret = process.env.TIENDANUBE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return bounce(request, { tiendanube: 'error', reason: 'not_configured' })
  }

  const state = rawState ? decodeState(rawState) : null
  const fromRiverz = Boolean(state && state.channel === 'tiendanube' && state.userId)

  // Un `state` presente pero ilegible no es una instalación desde
  // Tiendanube: es la nuestra, rota o manipulada. Tratarla como anónima
  // ataría la tienda a quien pase por el panel primero.
  if (rawState && !fromRiverz) {
    return bounce(request, { tiendanube: 'error', reason: 'invalid_state' })
  }

  let token: { accessToken: string; storeId: string; scope: string }
  try {
    token = await exchangeTiendanubeCode({ code, clientId, clientSecret })
  } catch (err) {
    log.captureException(err, { origin: fromRiverz ? 'riverz' : 'tiendanube' })
    return bounce(request, { tiendanube: 'error', reason: 'exchange_failed' })
  }

  const admin = supabaseAdmin()

  // Quién es el dueño. Desde Riverz lo dice el state; desde Tiendanube
  // sólo lo sabemos si la tienda ya estuvo conectada alguna vez.
  let userId = fromRiverz ? state!.userId : null
  let workspaceId = fromRiverz ? state!.workspaceId : null

  if (!userId) {
    const { data: previo } = await admin
      .from('shopify_connections')
      .select('user_id, workspace_id')
      .eq('platform', 'tiendanube')
      .eq('external_store_id', token.storeId)
      .order('installed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (previo?.user_id && previo?.workspace_id) {
      userId = previo.user_id as string
      workspaceId = previo.workspace_id as string
      log.info('reinstall_bound_to_previous_owner', { storeId: token.storeId })
    }
  }

  // Comercio nuevo llegando desde la tienda de aplicaciones: estacionar.
  if (!userId || !workspaceId) {
    try {
      const { claimToken } = await createPendingInstall(admin, {
        platform: 'tiendanube',
        // El dominio real hay que preguntárselo a la API de Tiendanube y
        // eso ya lo hace `completeTiendanubeConnection` al reclamar. Acá
        // alcanza con una clave estable derivada del id de tienda.
        shopDomain: `${token.storeId}.mitiendanube.com`,
        externalStoreId: token.storeId,
        accessToken: token.accessToken,
        scope: token.scope,
      })
      log.info('install_parked_pending_claim', { storeId: token.storeId })

      const locale = await getLocale()
      const destino = new URL(
        localizePath(signupsOpen() ? '/registro' : '/ingresar', locale),
        process.env.NEXT_PUBLIC_SITE_URL || url.origin,
      )
      destino.searchParams.set('tiendanube', 'pending')

      const res = NextResponse.redirect(destino)
      const opts = {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        maxAge: 24 * 60 * 60,
        path: '/',
      }
      res.cookies.set(TN_CLAIM_COOKIE, claimToken, { ...opts, httpOnly: true })
      res.cookies.set(TN_CLAIM_HINT_COOKIE, token.storeId, {
        ...opts,
        httpOnly: false,
      })
      return res
    } catch (err) {
      log.captureException(err, { storeId: token.storeId })
      return bounce(request, { tiendanube: 'error', reason: 'pending_failed' })
    }
  }

  try {
    const result = await completeTiendanubeConnection(admin, {
      userId,
      workspaceId,
      storeId: token.storeId,
      accessToken: token.accessToken,
      scope: token.scope,
    })
    log.info('connected', {
      workspaceId,
      shopDomain: result.shopDomain,
      products: result.productsSynced,
      origin: fromRiverz ? 'riverz' : 'tiendanube',
    })
    return bounce(request, {
      tiendanube: 'connected',
      products: String(result.productsSynced),
    })
  } catch (err) {
    log.captureException(err, { workspaceId })
    return bounce(request, { tiendanube: 'error', reason: 'exchange_failed' })
  }
}
