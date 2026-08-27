import type { SupabaseClient } from '@supabase/supabase-js';
import { ShopifyAdminClient } from '@/lib/shopify/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * Shared Shopify-attribution primitives.
 *
 * Both the cross-entity revenue view (/api/analytics/attribution) and the
 * Instagram-agent incrementality engine (src/lib/instagram-agent/attribution.ts)
 * read the workspace's Shopify connection, decrypt its token, and pull recent
 * orders. They used to duplicate the `ShopifyOrder` shape, the `normPhone`
 * helper, and the connection-read+decrypt block verbatim — and the two copies
 * had already drifted. This module is the single source of truth so a future
 * change to "how we read orders" or "how we match a phone" lands in one place.
 *
 * It does NOT unify the attribution *models* themselves: the IG engine is
 * deterministic (per-recipient discount codes + a holdout control group for
 * incrementality), while /metricas is a last-touch heuristic. Those stay
 * separate by design; only the shared plumbing lives here.
 */

export interface ShopifyOrder {
  id: number;
  /**
   * Cómo llama la tienda a ese pedido ("#1042"). El id interno no le dice
   * nada a nadie: para verificar una atribución hay que poder buscar el
   * pedido en la tienda, y se busca por este número.
   */
  name?: string | null;
  order_number?: number | null;
  email?: string;
  phone?: string;
  total_price?: string;
  currency?: string;
  created_at: string;
  discount_codes?: Array<{ code?: string }>;
  /**
   * Quién compró, por todos los lados donde Shopify lo guarda.
   *
   * `email`/`phone` de la raíz no alcanzan: `phone` es el número de avisos por
   * SMS y viene vacío salvo que el comprador lo cargue a mano, mientras que el
   * número real vive en el cliente o en la dirección. Emparejar sólo por la
   * raíz deja afuera justo al comprador que llegó por WhatsApp —el único que
   * nos importa acá— y su compra se lee como "no compró".
   */
  contact_email?: string | null;
  customer?: { email?: string | null; phone?: string | null } | null;
  shipping_address?: { phone?: string | null } | null;
  billing_address?: { phone?: string | null } | null;
  /** Cancelado: existe pero no es una venta. */
  cancelled_at?: string | null;
  /** `paid`, `pending`, `refunded`, `voided`… */
  financial_status?: string | null;
}

export interface ActiveShopifyConnection {
  shopDomain: string;
  /** Decrypted Shopify Admin API access token. */
  token: string;
}

/**
 * Normalize a phone to digits-only for cross-system matching (Shopify order
 * phone vs contacts.phone, which can carry +, spaces, parens). Returns null
 * for anything too short to be a real number, so a stray "1" never matches.
 */
export function normPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/[^\d]/g, '');
  return d.length >= 8 ? d : null;
}

/**
 * The workspace's active Shopify connection with a usable (decrypted) token,
 * or null when there is none. `null` covers three cases the callers all treat
 * identically as "no Shopify": no active row for the workspace, or a row whose
 * token can't be decrypted (e.g. ENCRYPTION_KEY rotated since install).
 *
 * Scope is `workspace_id` (migration 055) — the authoritative tenant key.
 * Callers must resolve the workspace the SAME way the connection was stored
 * (resolveWorkspaceIdForUser), or a genuinely-connected shop reads as missing.
 */
export async function getActiveShopifyConnection(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ActiveShopifyConnection | null> {
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
    return { shopDomain: row.shop_domain, token: decrypt(row.access_token) };
  } catch {
    return null;
  }
}

/**
 * Recent orders for a connection. Throws on a Shopify API failure so callers
 * can distinguish "fetch failed, try later" from "no orders" / "not connected".
 *
 * NOTE: single page only — no Link/page_info pagination. On a store with more
 * than `limit` (250) orders in the window, the tail is silently dropped, which
 * undercounts attribution and (for the IG incrementality engine) skews the
 * treatment/control baselines. Acceptable at current pilot volumes; if a
 * merchant exceeds this, follow the `Link: rel=next` cursor and accumulate.
 */
/**
 * El estado de pago de UN pedido, ahora mismo.
 *
 * Hace falta para los pedidos que se pagan por transferencia: el webhook trae
 * el estado que tenía al crearse ("pending") y eso queda congelado en el
 * contexto del flujo. Preguntar de nuevo después de la espera es la única
 * forma de no mandarle un recordatorio a quien ya transfirió.
 *
 * Devuelve null si no se pudo consultar — quien llama decide, y para un
 * recordatorio la respuesta prudente es no mandarlo.
 */
export async function fetchOrderFinancialStatus(
  conn: ActiveShopifyConnection,
  orderId: string,
): Promise<string | null> {
  const client = new ShopifyAdminClient(conn.shopDomain, conn.token);
  try {
    const data = await client.rest<{ order?: { financial_status?: string | null } }>(
      `/orders/${encodeURIComponent(orderId)}.json?fields=financial_status`,
    );
    return data.order?.financial_status ?? null;
  } catch {
    return null;
  }
}

export async function fetchRecentOrders(
  conn: ActiveShopifyConnection,
  sinceIso: string,
  limit = 250,
): Promise<ShopifyOrder[]> {
  const client = new ShopifyAdminClient(conn.shopDomain, conn.token);
  // `order=created_at desc` va explícito. Sin él, cuál página devuelve Shopify
  // cuando hay más de 250 pedidos en la ventana depende de un default que no
  // está contratado: el día que cambie, la única página que se lee sería la
  // más VIEJA y el pedido de hoy —el que se está buscando— no vendría nunca.
  const data = await client.rest<{ orders: ShopifyOrder[] }>(
    `/orders.json?status=any&order=created_at+desc` +
      `&created_at_min=${encodeURIComponent(sinceIso)}&limit=${limit}`,
  );
  return data.orders ?? [];
}
