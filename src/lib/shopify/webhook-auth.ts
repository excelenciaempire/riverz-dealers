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
 *  - oauth: the global app signs with SHOPIFY_API_SECRET. During the App
 *    Store transition TWO global apps coexist — the new public "Riverz"
 *    app (primary env pair) and the legacy custom-distribution "Riverz
 *    Inbox" app that existing stores (Pilar) are still installed on. A
 *    webhook registered under the legacy app signs with ITS secret, so we
 *    verify against SHOPIFY_API_SECRET first and fall back to
 *    SHOPIFY_API_SECRET_LEGACY.
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

  const hmac = request.headers.get('x-shopify-hmac-sha256')

  if (resolution.mode === 'per_store') {
    return verifyWebhookHmac(rawBody, hmac, resolution.secret) ? 'ok' : 'invalid'
  }

  const secrets = [
    process.env.SHOPIFY_API_SECRET,
    process.env.SHOPIFY_API_SECRET_LEGACY,
  ].filter((s): s is string => Boolean(s))
  if (!secrets.length) return 'unconfigured'

  return secrets.some((s) => verifyWebhookHmac(rawBody, hmac, s))
    ? 'ok'
    : 'invalid'
}
