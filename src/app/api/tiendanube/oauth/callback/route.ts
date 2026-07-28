import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decodeState } from '@/lib/channels/oauth'
import { exchangeTiendanubeCode } from '@/lib/commerce/providers/tiendanube'
import { completeTiendanubeConnection } from '@/lib/commerce/setup'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('tiendanube.callback')

/**
 * GET /api/tiendanube/oauth/callback?code=…&state=…
 *
 * Cierra la instalación: canjea el código, lee los datos de la tienda,
 * guarda la conexión, registra webhooks y trae el catálogo.
 *
 * El `state` firmado es la ÚNICA garantía de a qué workspace pertenece
 * esta tienda: Tiendanube no manda nada que lo identifique y la sesión
 * puede haber vencido durante el rodeo por su portal. Sin state válido
 * no conectamos — atar la tienda a un workspace adivinado sería peor que
 * fallar.
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

  const state = rawState ? decodeState(rawState) : null
  if (!state || state.channel !== 'tiendanube' || !state.userId) {
    return bounce(request, { tiendanube: 'error', reason: 'invalid_state' })
  }

  const clientId = process.env.TIENDANUBE_APP_ID
  const clientSecret = process.env.TIENDANUBE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return bounce(request, { tiendanube: 'error', reason: 'not_configured' })
  }

  try {
    const token = await exchangeTiendanubeCode({ code, clientId, clientSecret })
    const result = await completeTiendanubeConnection(supabaseAdmin(), {
      userId: state.userId,
      workspaceId: state.workspaceId,
      storeId: token.storeId,
      accessToken: token.accessToken,
      scope: token.scope,
    })
    log.info('connected', {
      workspaceId: state.workspaceId,
      shopDomain: result.shopDomain,
      products: result.productsSynced,
    })
    return bounce(request, {
      tiendanube: 'connected',
      products: String(result.productsSynced),
    })
  } catch (err) {
    log.captureException(err, { workspaceId: state.workspaceId })
    return bounce(request, { tiendanube: 'error', reason: 'exchange_failed' })
  }
}
