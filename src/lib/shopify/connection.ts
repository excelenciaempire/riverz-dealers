import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

export interface ShopifyConnectionRow {
  id: string
  user_id: string
  workspace_id: string
  shop_domain: string
  shop_name: string | null
  access_token: string
  scope: string | null
  status: 'active' | 'uninstalled' | 'expired' | 'error'
  installed_at: string | null
  uninstalled_at: string | null
  /** 'oauth' = global OAuth app; 'admin_token' = per-store custom app. */
  connection_method: 'oauth' | 'admin_token'
}

/**
 * Upsert a connection by (workspace_id, shop_domain), encrypting the token.
 *
 * `workspace_id` is the authoritative scope after migration 055 — the
 * OAuth callback resolves it from the installer's session/cookie and
 * passes it in. `user_id` is still persisted as "who installed it" for
 * audit purposes, but is no longer the lookup key.
 */
export async function persistShopifyConnection(
  db: SupabaseClient,
  args: {
    userId: string
    workspaceId: string
    shopDomain: string
    shopName?: string | null
    accessToken: string
    scope?: string | null
    /**
     * Per-store custom app's API secret key (admin-token path), used to
     * HMAC-verify that store's webhooks. Encrypted before persisting.
     * Omit for the OAuth path (webhooks verify against SHOPIFY_API_SECRET).
     */
    webhookSecret?: string | null
    connectionMethod?: 'oauth' | 'admin_token'
    /** Segundos de vida del token. Presente desde que Shopify dio de baja los
     *  que no expiran (migración 194). */
    expiresIn?: number | null
    /** Con qué renovarlo, sin volver a molestar al comercio. */
    refreshToken?: string | null
    refreshTokenExpiresIn?: number | null
  },
): Promise<{ id: string }> {
  // Only set webhook_secret / connection_method when provided, so an OAuth
  // reconnect never wipes a prior admin-token connection's per-store secret
  // (PostgREST upsert merges — columns absent from the payload keep their
  // existing values).
  const row: Record<string, unknown> = {
    user_id: args.userId,
    workspace_id: args.workspaceId,
    shop_domain: args.shopDomain,
    shop_name: args.shopName ?? null,
    access_token: encrypt(args.accessToken),
    scope: args.scope ?? null,
    status: 'active',
    last_error: null,
    installed_at: new Date().toISOString(),
    uninstalled_at: null,
  }
  if (args.connectionMethod) row.connection_method = args.connectionMethod
  if (args.webhookSecret != null) {
    row.webhook_secret = encrypt(args.webhookSecret)
  }
  // El vencimiento y el refresh se escriben SIEMPRE que vengan, incluso en
  // null: una reconexión que emitiera un token viejo tiene que borrar el
  // vencimiento anterior, o quedaría una fecha de otro token gobernando cuándo
  // se renueva éste.
  if (args.expiresIn !== undefined) {
    row.token_expires_at = args.expiresIn
      ? new Date(Date.now() + args.expiresIn * 1000).toISOString()
      : null
  }
  if (args.refreshToken !== undefined) {
    row.refresh_token_encrypted = args.refreshToken ? encrypt(args.refreshToken) : null
  }
  if (args.refreshTokenExpiresIn !== undefined) {
    row.refresh_token_expires_at = args.refreshTokenExpiresIn
      ? new Date(Date.now() + args.refreshTokenExpiresIn * 1000).toISOString()
      : null
  }

  const { data, error } = await db
    .from('shopify_connections')
    .upsert(row, { onConflict: 'user_id,shop_domain' })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to persist Shopify connection: ${error?.message}`)
  }
  return { id: data.id as string }
}

/** Look up the active connection for a shop domain (webhook path).
 *
 * When a merchant re-installs while signed in as a different user
 * (co-worker, ownership transfer, support seat) the upsert key
 * (user_id, shop_domain) diverges and we INSERT a second active row.
 * `.maybeSingle()` would then throw, silently breaking every order /
 * checkout / customer webhook. Order by `installed_at DESC` + limit 1
 * so the newest install always wins — matches `getConnectionForWorkspace`.
 */
export async function getConnectionByShop(
  db: SupabaseClient,
  shopDomain: string,
): Promise<{ row: ShopifyConnectionRow; accessToken: string } | null> {
  const { data } = await db
    .from('shopify_connections')
    .select('*')
    // Migration 126 made this table multi-platform. Every Shopify path
    // must scope itself: without this filter a workspace that also has
    // Tiendanube or WooCommerce connected could hand a Woo consumer_key
    // to the Shopify Admin API.
    .eq('platform', 'shopify')
    .eq('shop_domain', shopDomain)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return {
    row: data as ShopifyConnectionRow,
    accessToken: decrypt((data as ShopifyConnectionRow).access_token),
  }
}

/**
 * How an incoming webhook for a given shop must be authenticated:
 *  - per_store:   verify against this decrypted per-store secret (the
 *    custom app's API secret key).
 *  - global:      verify against process.env.SHOPIFY_API_SECRET (the global
 *    OAuth app, or an unknown shop).
 *  - fail_closed: the shop's newest connection is admin_token but its
 *    per-store secret is missing/undecryptable. We must NOT silently fall
 *    back to the global secret (that would move the trust boundary back to
 *    the shared authority), so the caller rejects (503) until it's fixed.
 */
export type ShopWebhookSecret =
  | { mode: 'per_store'; secret: string }
  | { mode: 'global' }
  | { mode: 'fail_closed' }

/**
 * Resolve which secret verifies an incoming webhook for `shopDomain`.
 *
 * The NEWEST connection row is authoritative about which app currently
 * signs the shop's webhooks, so we read it directly by `installed_at DESC`
 * (NOT filtered by `webhook_secret IS NOT NULL`) — otherwise a stale
 * admin_token row could shadow a newer OAuth reconnect and 401 its
 * legitimate deliveries. `connection_method` decides the mode, so a leftover
 * `webhook_secret` on a row that's now OAuth is correctly ignored.
 *
 * NOT filtered by status: shop/redact and app/uninstalled arrive after the
 * connection is flipped to 'uninstalled', and we still need the secret to
 * verify them. Requires a service-role client — `webhook_secret` is
 * column-locked from the cookie client (migration 078/087).
 */
export async function resolveShopWebhookSecret(
  db: SupabaseClient,
  shopDomain: string,
): Promise<ShopWebhookSecret> {
  const { data } = await db
    .from('shopify_connections')
    .select('connection_method, webhook_secret')
    .eq('platform', 'shopify')
    .eq('shop_domain', shopDomain)
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const row = data as
    | { connection_method?: string | null; webhook_secret?: string | null }
    | null
  if (!row) return { mode: 'global' }
  if (row.connection_method === 'admin_token') {
    if (!row.webhook_secret) return { mode: 'fail_closed' }
    try {
      return { mode: 'per_store', secret: decrypt(row.webhook_secret) }
    } catch {
      // Undecryptable per-store secret (ENCRYPTION_KEY rotation / corrupt
      // write): fail closed rather than fall back to the global authority.
      return { mode: 'fail_closed' }
    }
  }
  return { mode: 'global' }
}

/**
 * The active connection for a workspace (Settings card path).
 *
 * Prefers a deterministic workspace_id match (migration 055). Falls back
 * to the legacy user_id-scoped read for callers that haven't been
 * migrated yet — but new code should pass workspaceId.
 */
export async function getConnectionForWorkspace(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Omit<ShopifyConnectionRow, 'access_token'> | null> {
  const { data } = await db
    .from('shopify_connections')
    .select(
      'id, user_id, workspace_id, shop_domain, shop_name, scope, status, installed_at, uninstalled_at, connection_method',
    )
    .eq('platform', 'shopify')
    .eq('workspace_id', workspaceId)
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as Omit<ShopifyConnectionRow, 'access_token'> | null) ?? null
}

/**
 * @deprecated since migration 055 — prefer `getConnectionForWorkspace`.
 * Kept for back-compat with UI hooks that still read by the
 * authenticated user_id. Internally tries the workspace path first when
 * the caller has a workspace handy.
 */
export async function getConnectionForUser(
  db: SupabaseClient,
  userId: string,
): Promise<Omit<ShopifyConnectionRow, 'access_token'> | null> {
  const { data } = await db
    .from('shopify_connections')
    .select(
      'id, user_id, workspace_id, shop_domain, shop_name, scope, status, installed_at, uninstalled_at, connection_method',
    )
    .eq('platform', 'shopify')
    .eq('user_id', userId)
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as Omit<ShopifyConnectionRow, 'access_token'> | null) ?? null
}
