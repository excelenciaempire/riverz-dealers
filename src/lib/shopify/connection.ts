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
  },
): Promise<{ id: string }> {
  const { data, error } = await db
    .from('shopify_connections')
    .upsert(
      {
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
      },
      { onConflict: 'user_id,shop_domain' },
    )
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
      'id, user_id, workspace_id, shop_domain, shop_name, scope, status, installed_at, uninstalled_at',
    )
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
      'id, user_id, workspace_id, shop_domain, shop_name, scope, status, installed_at, uninstalled_at',
    )
    .eq('user_id', userId)
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as Omit<ShopifyConnectionRow, 'access_token'> | null) ?? null
}
