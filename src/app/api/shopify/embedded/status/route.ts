import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifySessionToken } from '@/lib/shopify/session-token'
import { hasPendingInstall } from '@/lib/shopify/pending-install'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('shopify.embedded-status')

/**
 * Connection status for the embedded page inside Shopify admin.
 *
 * Auth is the App Bridge session token (Authorization: Bearer <JWT>),
 * NOT a Riverz session — the merchant browsing their Shopify admin
 * usually has no Riverz cookies in that context. The token pins the
 * shop, and we only ever reveal coarse state for that same shop:
 *
 *   connected — an active connection exists (any workspace)
 *   pending   — OAuth done, waiting for the merchant to link a Riverz
 *               account (shopify_pending_installs)
 *   none      — not installed / uninstalled
 */
export async function GET(request: Request) {
  // Two app identities can mint session tokens during the App Store
  // transition: the public "Riverz" app (primary) and the legacy
  // custom-distribution app that existing stores still have installed.
  const pairs = [
    {
      apiKey: process.env.SHOPIFY_API_KEY,
      apiSecret: process.env.SHOPIFY_API_SECRET,
    },
    {
      apiKey: process.env.SHOPIFY_API_KEY_LEGACY,
      apiSecret: process.env.SHOPIFY_API_SECRET_LEGACY,
    },
  ].filter((p): p is { apiKey: string; apiSecret: string } =>
    Boolean(p.apiKey && p.apiSecret),
  )
  if (!pairs.length) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const verified = token
    ? pairs.reduce<ReturnType<typeof verifySessionToken>>(
        (acc, pair) => acc ?? verifySessionToken(token, pair),
        null,
      )
    : null
  if (!verified) {
    log.warn('session_token_rejected', { hasToken: Boolean(token) })
    return NextResponse.json({ error: 'invalid_session_token' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: connection } = await admin
    .from('shopify_connections')
    .select('status')
    .eq('platform', 'shopify')
    .eq('shop_domain', verified.shop)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  const state = connection
    ? 'connected'
    : (await hasPendingInstall(admin, verified.shop))
      ? 'pending'
      : 'none'

  return NextResponse.json({ shop: verified.shop, state })
}
