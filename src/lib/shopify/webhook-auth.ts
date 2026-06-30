import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyWebhookHmac } from './oauth'
import { resolveShopWebhookSecret } from './connection'

/**
 * Resolve the signing secret for an incoming Shopify webhook and verify its
 * HMAC.
 *
 * Two connection models coexist:
 *  - admin_token: the merchant's own custom app signs its webhooks with
 *    THAT app's API secret key, stored (encrypted) per connection.
 *  - oauth: the global app signs with SHOPIFY_API_SECRET.
 *
 * The shop's NEWEST connection decides which secret to use (see
 * resolveShopWebhookSecret). An admin_token store NEVER falls back to the
 * global secret — if its per-store secret is missing/undecryptable we fail
 * closed, keeping the per-store trust boundary intact.
 *
 * Verdicts map to the fail-closed posture the receivers already use:
 *  - 'ok'           → signature valid, proceed
 *  - 'invalid'      → signature present but wrong → 401
 *  - 'unconfigured' → no secret available (or a broken per-store secret) →
 *                     503 (never accept unverified)
 */
export async function verifyShopifyWebhook(
  db: SupabaseClient,
  request: Request,
  rawBody: string,
): Promise<'ok' | 'invalid' | 'unconfigured'> {
  const shopDomain = request.headers.get('x-shopify-shop-domain')
  const resolution = shopDomain
    ? await resolveShopWebhookSecret(db, shopDomain)
    : ({ mode: 'global' } as const)
  if (resolution.mode === 'fail_closed') return 'unconfigured'

  const secret =
    resolution.mode === 'per_store'
      ? resolution.secret
      : process.env.SHOPIFY_API_SECRET
  if (!secret) return 'unconfigured'

  const hmac = request.headers.get('x-shopify-hmac-sha256')
  return verifyWebhookHmac(rawBody, hmac, secret) ? 'ok' : 'invalid'
}
