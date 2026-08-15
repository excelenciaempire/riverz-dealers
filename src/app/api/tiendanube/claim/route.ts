import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import { claimPendingInstall } from '@/lib/shopify/pending-install'
import {
  TN_CLAIM_COOKIE,
  TN_CLAIM_HINT_COOKIE,
} from '@/lib/commerce/tiendanube-claim-cookies'
import { completeTiendanubeConnection } from '@/lib/commerce/setup'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('tiendanube.claim')

/**
 * POST /api/tiendanube/claim
 *
 * Ata al workspace de quien pregunta una tienda que se instaló desde la
 * tienda de aplicaciones de Tiendanube, antes de que existiera la cuenta.
 * El callback dejó el token cifrado en la base y una cookie de reclamo de
 * un solo uso; el panel llama acá en cuanto el comercio entra.
 *
 * Las cookies se borran SIEMPRE en la respuesta: si salió bien ya se
 * consumió, y si el token era desconocido o venció, reintentarlo no va a
 * cambiar nada y quedaría reintentando en cada carga.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block

  const locale = await getLocale()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jar = await cookies()
  const rawToken = jar.get(TN_CLAIM_COOKIE)?.value
  if (!rawToken) {
    return limpiando(NextResponse.json({ error: 'no_pending' }, { status: 404 }))
  }

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errStores.noWorkspace') },
      { status: 400 },
    )
  }

  const pending = await claimPendingInstall(admin, rawToken)
  if (!pending || pending.platform !== 'tiendanube' || !pending.externalStoreId) {
    return limpiando(
      NextResponse.json(
        { error: translate(locale, 'errStores.tiendanubeClaimExpired') },
        { status: 410 },
      ),
    )
  }

  try {
    const result = await completeTiendanubeConnection(admin, {
      userId: user.id,
      workspaceId,
      storeId: pending.externalStoreId,
      accessToken: pending.accessToken,
      scope: pending.scope ?? '',
    })
    log.info('claim_success', {
      storeId: pending.externalStoreId,
      shopDomain: result.shopDomain,
      workspaceId,
    })
    return limpiando(
      NextResponse.json({ ok: true, shop: result.shopDomain }),
    )
  } catch (err) {
    log.captureException(err, { storeId: pending.externalStoreId })
    return limpiando(
      NextResponse.json(
        { error: translate(locale, 'errStores.tiendanubeClaimFailed') },
        { status: 500 },
      ),
    )
  }
}

function limpiando(res: NextResponse): NextResponse {
  res.cookies.delete(TN_CLAIM_COOKIE)
  res.cookies.delete(TN_CLAIM_HINT_COOKIE)
  return res
}
