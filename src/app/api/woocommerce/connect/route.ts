import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { encodeState } from '@/lib/channels/oauth'
import {
  buildWooAuthorizeUrl,
  normalizeWooSiteUrl,
} from '@/lib/commerce/providers/woocommerce'
import { completeWooConnection } from '@/lib/commerce/setup'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { StoreUnauthorizedError } from '@/lib/commerce/types'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('woocommerce.connect')

/**
 * POST /api/woocommerce/connect
 *
 * Dos caminos según lo que mande el cuerpo:
 *
 *  a) `{ siteUrl }` → devuelve la URL de aprobación de /wc-auth. El
 *     comercio la abre, aprueba en su wp-admin y WooCommerce nos POSTea
 *     las claves al callback. Es el camino de un clic.
 *
 *  b) `{ siteUrl, consumerKey, consumerSecret }` → conectamos directo.
 *     Necesario porque /wc-auth falla en instalaciones detrás de un
 *     proxy/login que bloquea el redirect, y ahí pegar las claves a mano
 *     (WooCommerce → Ajustes → Avanzado → REST API) es la única salida.
 */
export async function POST(req: Request) {
  const block = await csrfGuard(req)
  if (block) return block

  const locale = await getLocale()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errStores.noWorkspace') },
      { status: 400 },
    )
  }

  let body: {
    siteUrl?: string
    consumerKey?: string
    consumerSecret?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const siteUrl = normalizeWooSiteUrl(body.siteUrl ?? '')
  if (!siteUrl) {
    return NextResponse.json(
      { error: translate(locale, 'errStores.invalidSiteUrl') },
      { status: 400 },
    )
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin

  // ── (b) claves pegadas a mano ──────────────────────────────────────
  const key = body.consumerKey?.trim()
  const secret = body.consumerSecret?.trim()
  if (key && secret) {
    try {
      const result = await completeWooConnection(supabaseAdmin(), {
        userId: user.id,
        workspaceId,
        siteUrl,
        consumerKey: key,
        consumerSecret: secret,
      })
      return NextResponse.json({
        ok: true,
        connected: true,
        shop_domain: result.shopDomain,
        shop_name: result.shopName,
        products: result.productsSynced,
      })
    } catch (err) {
      if (err instanceof StoreUnauthorizedError) {
        return NextResponse.json(
          { error: translate(locale, 'errStores.wooInvalidKeys') },
          { status: 400 },
        )
      }
      log.captureException(err, { workspaceId, siteUrl })
      return NextResponse.json(
        { error: translate(locale, 'errStores.wooUnreachable') },
        { status: 400 },
      )
    }
  }

  // ── (a) flujo /wc-auth ─────────────────────────────────────────────
  // El state firmado viaja como `user_id` y vuelve tal cual en el
  // callback, que es una ruta pública sin sesión: es lo único que ata
  // las claves entrantes a este workspace.
  const state = encodeState({
    workspaceId,
    channel: 'woocommerce',
    userId: user.id,
    storeDomain: siteUrl,
  })

  return NextResponse.json({
    ok: true,
    authorizeUrl: buildWooAuthorizeUrl({
      siteUrl,
      state,
      returnUrl: `${base}/api/woocommerce/auth/return`,
      callbackUrl: `${base}/api/woocommerce/auth/callback`,
    }),
  })
}
