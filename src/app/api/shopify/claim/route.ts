import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { csrfGuard } from '@/lib/csrf'
import {
  claimPendingInstall,
  CLAIM_COOKIE,
  CLAIM_HINT_COOKIE,
} from '@/lib/shopify/pending-install'
import { completeShopifyConnection } from '@/lib/shopify/complete-connection'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('shopify.claim')

/**
 * Claim a pending Shopify install (App Store flow: the merchant installed
 * from Shopify admin BEFORE having a Riverz account). The OAuth callback
 * parked the encrypted token in `shopify_pending_installs` and set an
 * httpOnly single-use claim cookie; once the merchant signs in/up, the
 * dashboard posts here and the store binds to their workspace.
 *
 * The claim cookie is always cleared in the response — success consumes
 * it, and an unknown/expired token would never succeed on retry.
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
  const rawToken = jar.get(CLAIM_COOKIE)?.value
  if (!rawToken) {
    return clearing(
      NextResponse.json({ error: 'no_pending' }, { status: 404 }),
    )
  }

  const admin = supabaseAdmin()
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id)
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.noWorkspaceForUser') },
      { status: 400 },
    )
  }

  const pending = await claimPendingInstall(admin, rawToken)
  if (!pending) {
    return clearing(
      NextResponse.json(
        { error: translate(locale, 'errProducts.shopifyClaimExpired') },
        { status: 410 },
      ),
    )
  }

  try {
    const callbackBase =
      process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
    await completeShopifyConnection(admin, {
      userId: user.id,
      workspaceId,
      shopDomain: pending.shopDomain,
      accessToken: pending.accessToken,
      scope: pending.scope,
      clientId: pending.clientId || process.env.SHOPIFY_API_KEY || '',
      callbackBase,
      shopName: pending.shopName,
    })
    log.info('claim_success', {
      shop: pending.shopDomain,
      userId: user.id,
      workspaceId,
    })
    return clearing(NextResponse.json({ ok: true, shop: pending.shopDomain }))
  } catch (err) {
    log.error('claim_persist_failed', {
      shop: pending.shopDomain,
      error: err instanceof Error ? err.message : String(err),
    })
    return clearing(
      NextResponse.json(
        { error: translate(locale, 'errProducts.shopifyClaimFailed') },
        { status: 500 },
      ),
    )
  }
}

function clearing(res: NextResponse): NextResponse {
  res.cookies.delete(CLAIM_COOKIE)
  res.cookies.delete(CLAIM_HINT_COOKIE)
  return res
}
