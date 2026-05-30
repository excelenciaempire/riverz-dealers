import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

export interface ShopifyConnectionRow {
  id: string
  user_id: string
  shop_domain: string
  shop_name: string | null
  access_token: string
  scope: string | null
  status: 'active' | 'uninstalled' | 'expired' | 'error'
  installed_at: string | null
  uninstalled_at: string | null
}

/** Upsert a connection by (user_id, shop_domain), encrypting the token. */
export async function persistShopifyConnection(
  db: SupabaseClient,
  args: {
    userId: string
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

/** Look up the active connection for a shop domain (webhook path). */
export async function getConnectionByShop(
  db: SupabaseClient,
  shopDomain: string,
): Promise<{ row: ShopifyConnectionRow; accessToken: string } | null> {
  const { data } = await db
    .from('shopify_connections')
    .select('*')
    .eq('shop_domain', shopDomain)
    .eq('status', 'active')
    .maybeSingle()
  if (!data) return null
  return {
    row: data as ShopifyConnectionRow,
    accessToken: decrypt((data as ShopifyConnectionRow).access_token),
  }
}

/** The current user's connection, for the Settings card (no token returned). */
export async function getConnectionForUser(
  db: SupabaseClient,
  userId: string,
): Promise<Omit<ShopifyConnectionRow, 'access_token'> | null> {
  const { data } = await db
    .from('shopify_connections')
    .select(
      'id, user_id, shop_domain, shop_name, scope, status, installed_at, uninstalled_at',
    )
    .eq('user_id', userId)
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as Omit<ShopifyConnectionRow, 'access_token'> | null) ?? null
}
