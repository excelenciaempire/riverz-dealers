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

/**
 * La tabla es de las tres plataformas desde la migración 149. El defecto
 * es 'shopify' para que las llamadas de ese flujo —que está en revisión—
 * no cambien ni una línea.
 */
type PendingPlatform = 'shopify' | 'tiendanube' | 'woocommerce'

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
    platform?: PendingPlatform
    externalStoreId?: string | null
    clientId?: string | null
  },
): Promise<{ claimToken: string }> {
  const claimToken = randomBytes(32).toString('hex')
  const { error } = await admin.from('shopify_pending_installs').upsert(
    {
      platform: args.platform ?? 'shopify',
      shop_domain: args.shopDomain,
      shop_name: args.shopName ?? null,
      external_store_id: args.externalStoreId ?? null,
      claim_token_hash: hashToken(claimToken),
      access_token: encrypt(args.accessToken),
      scope: args.scope ?? null,
      client_id_encrypted: args.clientId ? encrypt(args.clientId) : null,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'platform,shop_domain' },
  )
  if (error) throw new Error(`pending install upsert failed: ${error.message}`)
  return { claimToken }
}

export interface ClaimedInstall {
  platform: PendingPlatform
  shopDomain: string
  shopName: string | null
  externalStoreId: string | null
  accessToken: string
  scope: string | null
  clientId: string | null
}

/**
 * Redeem a claim token: returns the decrypted install and deletes the row,
 * or null when the token is unknown/expired. Single-use by construction.
 *
 * El token identifica la fila por sí solo, así que no hace falta decir de
 * qué plataforma es: la fila lo dice.
 */
export async function claimPendingInstall(
  admin: SupabaseClient,
  rawToken: string,
): Promise<ClaimedInstall | null> {
  if (!/^[a-f0-9]{64}$/.test(rawToken)) return null
  const { data: row } = await admin
    .from('shopify_pending_installs')
    .select(
      'id, platform, shop_domain, shop_name, external_store_id, access_token, scope, client_id_encrypted, created_at',
    )
    .eq('claim_token_hash', hashToken(rawToken))
    .maybeSingle()
  if (!row) return null

  // Delete first so the token is single-use even if two claims race.
  await admin.from('shopify_pending_installs').delete().eq('id', row.id)

  const createdAt = row.created_at ? Date.parse(row.created_at) : 0
  if (!createdAt || Date.now() - createdAt > CLAIM_TTL_MS) return null

  return {
    platform: (row.platform ?? 'shopify') as PendingPlatform,
    shopDomain: row.shop_domain,
    shopName: row.shop_name ?? null,
    externalStoreId: row.external_store_id ?? null,
    accessToken: decrypt(row.access_token),
    scope: row.scope ?? null,
    clientId: row.client_id_encrypted ? decrypt(row.client_id_encrypted) : null,
  }
}

/**
 * ¿Este token de reclamo corresponde a una instalación estacionada y vigente?
 *
 * Mira sin consumir: lo usa el alta de cuenta para saber si quien se registra
 * llega de verdad instalando desde una tienda de aplicaciones. Sin esta
 * comprobación alcanzaría con inventarse la cookie para saltarse el cierre de
 * registro del prelanzamiento.
 */
export async function pendingInstallExists(
  admin: SupabaseClient,
  rawToken: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(rawToken)) return false
  const { data: row } = await admin
    .from('shopify_pending_installs')
    .select('created_at')
    .eq('claim_token_hash', hashToken(rawToken))
    .maybeSingle()
  if (!row?.created_at) return false
  return Date.now() - Date.parse(row.created_at) <= CLAIM_TTL_MS
}

/** Whether a shop currently has an unclaimed pending install (not expired). */
export async function hasPendingInstall(
  admin: SupabaseClient,
  shopDomain: string,
  platform: PendingPlatform = 'shopify',
): Promise<boolean> {
  const { data: row } = await admin
    .from('shopify_pending_installs')
    .select('created_at')
    .eq('platform', platform)
    .eq('shop_domain', shopDomain)
    .maybeSingle()
  if (!row?.created_at) return false
  return Date.now() - Date.parse(row.created_at) <= CLAIM_TTL_MS
}
