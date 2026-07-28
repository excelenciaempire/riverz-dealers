/**
 * Shopify order write-back for COD confirmation calls.
 *
 * When a voice call resolves (confirmed / cancelled), we stamp the outcome on
 * the Shopify order as a tag so the merchant's logistics (and fulfillment apps
 * like Dropi) can act on it. REST Admin API: GET current tags → merge → PUT.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { shopifyApiVersion } from '@/lib/shopify/oauth';

export interface ShopifyAdmin {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

/** Resolve the workspace's active Shopify admin credentials, or null. */
export async function resolveShopifyAdmin(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ShopifyAdmin | null> {
  const { data } = await db
    .from('shopify_connections')
    .select('shop_domain, access_token, status')
    .eq('platform', 'shopify')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { shop_domain: string; access_token: string } | null;
  if (!row) return null;
  try {
    return {
      shopDomain: row.shop_domain,
      accessToken: decrypt(row.access_token),
      apiVersion: shopifyApiVersion(),
    };
  } catch {
    return null;
  }
}

/** Append tags to a Shopify order (idempotent — merges with existing). */
export async function appendOrderTags(
  admin: ShopifyAdmin,
  orderId: string | number,
  newTags: string[],
): Promise<boolean> {
  const clean = newTags.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return false;
  const base = `https://${admin.shopDomain}/admin/api/${admin.apiVersion}/orders/${orderId}.json`;
  const headers = {
    'X-Shopify-Access-Token': admin.accessToken,
    'Content-Type': 'application/json',
  };
  try {
    const cur = await fetch(`${base}?fields=id,tags`, { headers });
    if (!cur.ok) return false;
    const curData = (await cur.json()) as { order?: { tags?: string } };
    const existing = (curData.order?.tags ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const merged = Array.from(new Set([...existing, ...clean]));
    // No change → skip the write.
    if (merged.length === existing.length) return true;
    const res = await fetch(base, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ order: { id: Number(orderId), tags: merged.join(', ') } }),
    });
    return res.ok;
  } catch (err) {
    console.error('[shopify] appendOrderTags failed:', err);
    return false;
  }
}
