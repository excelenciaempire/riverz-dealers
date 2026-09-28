/**
 * Shopify order write-back for COD confirmation calls.
 *
 * When a voice call resolves (confirmed / cancelled), we stamp the outcome on
 * the Shopify order as a tag so the merchant's logistics (and fulfillment apps
 * like Dropi) can act on it. REST Admin API: GET current tags → merge → PUT.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { tokenVivo, COLUMNAS_TOKEN } from './token-vivo';
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
    .select(`${COLUMNAS_TOKEN}, status`)
    .eq('platform', 'shopify')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as Parameters<typeof tokenVivo>[1] | null;
  if (!row) return null;
  try {
    // Renovado si estaba por vencer. El token de Shopify dura una hora desde
    // que dejaron de aceptar los que no expiran (migración 194); leerlo tal
    // cual devolvía uno muerto y el pedido de la clienta fallaba sin motivo.
    const { accessToken } = await tokenVivo(db, row);
    return {
      shopDomain: row.shop_domain,
      accessToken,
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

export type DeliveryIncidentTagState = 'active' | 'resolved';

function normalizeIncidentTag(tag: string): string {
  return tag
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isDeliveryIncidentTag(tag: string): boolean {
  const normalized = normalizeIncidentTag(tag);
  return (
    normalized === 'novedad solucionada' ||
    /^novedad(?:\s*[:\-].*)?$/.test(normalized)
  );
}

export function nextDeliveryIncidentTags(
  existing: string[],
  state: DeliveryIncidentTagState,
  reason = '',
): string[] {
  const preserved = existing
    .map((tag) => tag.trim())
    .filter((tag) => tag && !isDeliveryIncidentTag(tag));
  const safeReason = reason.replace(/[,\r\n]+/g, '; ').replace(/\s+/g, ' ').trim();
  const incidentTag =
    state === 'resolved'
      ? 'NOVEDAD SOLUCIONADA'
      : `NOVEDAD: ${safeReason || 'La transportadora requiere información'}`.slice(
          0,
          180,
        );
  return [...new Set([...preserved, incidentTag])];
}

export async function setDeliveryIncidentOrderTag(
  admin: ShopifyAdmin,
  orderId: string | number,
  state: DeliveryIncidentTagState,
  reason = '',
): Promise<{ ok: boolean; changed: boolean }> {
  const base = `https://${admin.shopDomain}/admin/api/${admin.apiVersion}/orders/${orderId}.json`;
  const headers = {
    'X-Shopify-Access-Token': admin.accessToken,
    'Content-Type': 'application/json',
  };
  try {
    const current = await fetch(`${base}?fields=id,tags,cancelled_at`, { headers });
    if (!current.ok) return { ok: false, changed: false };
    const body = (await current.json()) as {
      order?: { id?: number; tags?: string; cancelled_at?: string | null };
    };
    if (!body.order?.id) return { ok: false, changed: false };
    if (state === 'active' && body.order.cancelled_at) {
      return { ok: true, changed: false };
    }
    const existing = String(body.order.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const next = nextDeliveryIncidentTags(existing, state, reason);
    if (next.join(', ') === existing.join(', ')) {
      return { ok: true, changed: false };
    }
    const updated = await fetch(base, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ order: { id: Number(orderId), tags: next.join(', ') } }),
    });
    return { ok: updated.ok, changed: updated.ok };
  } catch (err) {
    console.error('[shopify] setDeliveryIncidentOrderTag failed:', err);
    return { ok: false, changed: false };
  }
}
