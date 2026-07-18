import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

/**
 * Pending Shopify installs (App Store flow: install first, sign in later).
 *
 * When OAuth completes with no Riverz session to bind to, the token parks
 * in `shopify_pending_installs` and the browser gets two cookies:
 *
 *  - `shopify_claim` (httpOnly): the raw claim token. Never readable by
 *    JS; the DB only stores its sha256, so neither a DB leak nor an XSS
 *    alone is enough to claim a shop.
 *  - `shopify_claim_shop` (JS-readable): just the shop domain, so the
 *    dashboard knows to auto-claim after the merchant signs in/up.
 *
 * Rows expire after CLAIM_TTL_MS (enforced at claim time) and are
 * replaced by reinstalls (upsert on shop_domain).
 */

export { CLAIM_COOKIE, CLAIM_HINT_COOKIE } from '@/lib/shopify/claim-cookies'
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000

function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

export async function createPendingInstall(
  admin: SupabaseClient,
  args: {
    shopDomain: string
    shopName?: string | null
    accessToken: string
    scope?: string | null
  },
): Promise<{ claimToken: string }> {
  const claimToken = randomBytes(32).toString('hex')
  const { error } = await admin.from('shopify_pending_installs').upsert(
    {
      shop_domain: args.shopDomain,
      shop_name: args.shopName ?? null,
      claim_token_hash: hashToken(claimToken),
      access_token: encrypt(args.accessToken),
      scope: args.scope ?? null,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'shop_domain' },
  )
  if (error) throw new Error(`pending install upsert failed: ${error.message}`)
  return { claimToken }
}

export interface ClaimedInstall {
  shopDomain: string
  shopName: string | null
  accessToken: string
  scope: string | null
}

/**
 * Redeem a claim token: returns the decrypted install and deletes the row,
 * or null when the token is unknown/expired. Single-use by construction.
 */
export async function claimPendingInstall(
  admin: SupabaseClient,
  rawToken: string,
): Promise<ClaimedInstall | null> {
  if (!/^[a-f0-9]{64}$/.test(rawToken)) return null
  const { data: row } = await admin
    .from('shopify_pending_installs')
    .select('id, shop_domain, shop_name, access_token, scope, created_at')
    .eq('claim_token_hash', hashToken(rawToken))
    .maybeSingle()
  if (!row) return null

  // Delete first so the token is single-use even if two claims race.
  await admin.from('shopify_pending_installs').delete().eq('id', row.id)

  const createdAt = row.created_at ? Date.parse(row.created_at) : 0
  if (!createdAt || Date.now() - createdAt > CLAIM_TTL_MS) return null

  return {
    shopDomain: row.shop_domain,
    shopName: row.shop_name ?? null,
    accessToken: decrypt(row.access_token),
    scope: row.scope ?? null,
  }
}

/** Whether a shop currently has an unclaimed pending install (not expired). */
export async function hasPendingInstall(
  admin: SupabaseClient,
  shopDomain: string,
): Promise<boolean> {
  const { data: row } = await admin
    .from('shopify_pending_installs')
    .select('created_at')
    .eq('shop_domain', shopDomain)
    .maybeSingle()
  if (!row?.created_at) return false
  return Date.now() - Date.parse(row.created_at) <= CLAIM_TTL_MS
}
