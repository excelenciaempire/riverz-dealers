import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encodeState } from '@/lib/channels/oauth'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import {
  buildTiendanubeAuthorizeUrl,
  tiendanubeAppId,
  tiendanubeConfigured,
} from '@/lib/commerce/providers/tiendanube'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'

/**
 * GET /api/tiendanube/oauth/start
 *
 * Arranca la instalación. A diferencia de Shopify, Tiendanube NO acepta
 * `redirect_uri` en la URL de autorización: la de retorno se fija en la
 * configuración de la app en el portal de partners, y tiene que apuntar
 * a /api/tiendanube/oauth/callback. Si no coincide, el flujo muere del
 * lado de ellos sin que podamos detectarlo.
 *
 * El `state` firmado lleva el workspace y el usuario porque el callback
 * puede llegar con la sesión ya vencida.
 */
export async function GET() {
  const locale = await getLocale()

  if (!tiendanubeConfigured()) {
    return NextResponse.json(
      { error: translate(locale, 'errStores.tiendanubeNotConfigured') },
      { status: 503 },
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errStores.noWorkspace') },
      { status: 400 },
    )
  }

  const state = encodeState({
    workspaceId,
    channel: 'tiendanube',
    userId: user.id,
  })

  return NextResponse.redirect(
    buildTiendanubeAuthorizeUrl(tiendanubeAppId()!, state),
  )
}
