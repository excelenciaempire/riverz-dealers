/**
 * Dropi integration (COD fulfillment, LatAm).
 *
 * On a confirmed COD call, push the order to Dropi so it goes to dispatch.
 * Dropi's API base + auth are per-workspace (dropi_connections). The exact
 * endpoint path and field names are configurable (config.orders_path,
 * config.base_url) because Dropi accounts/regions differ — defaults are
 * sensible but the merchant can override at connect time. Fail-soft: a Dropi
 * error never breaks the call result.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

export interface DropiConfig {
  /** API base, e.g. "https://api.dropi.co". */
  base_url?: string;
  /** Orders endpoint path (default "/orders"). */
  orders_path?: string;
  /** Country integration id / warehouse, if the account needs it. */
  integration_id?: string;
}

export interface DropiConnection {
  apiKey: string | null;
  config: DropiConfig;
  status: string;
}

export async function getDropiConnection(
  db: SupabaseClient,
  workspaceId: string,
): Promise<DropiConnection | null> {
  const { data } = await db
    .from('dropi_connections')
    .select('api_key_encrypted, config, status')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    api_key_encrypted: string | null;
    config: DropiConfig | null;
    status: string;
  };
  let apiKey: string | null = null;
  if (row.api_key_encrypted) {
    try {
      apiKey = decrypt(row.api_key_encrypted);
    } catch {
      apiKey = null;
    }
  }
  return { apiKey, config: row.config ?? {}, status: row.status };
}

export interface DropiOrderInput {
  order_name?: string;
  customer_name?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  country?: string;
  total?: string | number;
  items?: unknown;
}

/**
 * Push a confirmed order to Dropi. Returns true on a 2xx. Never throws.
 * Only runs when a Dropi connection exists and is active.
 */
export async function pushOrderToDropi(
  db: SupabaseClient,
  workspaceId: string,
  order: DropiOrderInput,
): Promise<boolean> {
  const conn = await getDropiConnection(db, workspaceId);
  if (!conn || conn.status !== 'connected' || !conn.apiKey) return false;
  const base = (conn.config.base_url || 'https://api.dropi.co').replace(/\/+$/, '');
  const path = conn.config.orders_path || '/orders';
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(conn.config.integration_id ? { integration_id: conn.config.integration_id } : {}),
        order: order,
      }),
    });
    if (!res.ok) {
      console.error('[dropi] push returned', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[dropi] push failed:', err);
    return false;
  }
}
