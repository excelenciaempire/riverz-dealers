/**
 * Contact enrichment — Shopify customer snapshot.
 *
 * Dado un contact con phone o email, consulta la Shopify Admin REST API
 * para encontrar el customer correspondiente y cachea en
 * `contacts.shopify_customer_data` un snapshot compacto:
 *
 *   - total_spent / currency
 *   - orders_count
 *   - last_order_date
 *   - tags
 *   - default_address completa (calle, ciudad, provincia, país, CP)
 *   - accepts_marketing
 *   - lifetime_orders: top-10 pedidos con titles de cada line item
 *
 * El runner de IA inyecta esto en el system prompt como:
 *   "Cliente en Shopify: gastó $X en Y pedidos, último pedido [date]. Tags: [tags]."
 *
 * Cacheo:
 *   - TTL 24h sobre `shopify_data_synced_at`. Si está fresca, no llama
 *     a Shopify; devuelve la fila cacheada.
 *   - Fail-soft: cualquier error de red / 4xx / 5xx devuelve null y deja
 *     `shopify_customer_data` como estaba.
 *
 * No usamos el helper `ShopifyAdminClient` porque queremos endpoints
 * específicos (/customers/search.json + /customers/:id/orders.json) y
 * un manejo de errores distinto (no throw, sino degradar).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, ShopifyCustomerSnapshot } from '@/types';
import { decrypt } from '@/lib/whatsapp/encryption';
import { shopifyApiVersion } from '@/lib/shopify/oauth';
import { normalizePhone, phoneVariants, phonesMatch } from '@/lib/whatsapp/phone-utils';
import { enrichContactFromStore } from '@/lib/commerce/enrich';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ShopifyConnectionForEnrich {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

export interface ShopifyCustomer {
  id: number;
  email: string | null;
  phone: string | null;
  tags?: string | null;
  accepts_marketing?: boolean;
  orders_count?: number;
  total_spent?: string;
  currency?: string;
  last_order_id?: number | null;
  default_address?: {
    address1?: string | null;
    address2?: string | null;
    country?: string | null;
    province?: string | null;
    city?: string | null;
    zip?: string | null;
  } | null;
}

export interface ShopifyOrderLite {
  /** Id del pedido: sin él no se puede enlazar al pedido en el admin. */
  id?: number | string;
  name: string;
  total_price: string;
  created_at: string;
  line_items?: Array<{ title: string }>;
}

/**
 * Resuelve la conexión Shopify activa de un workspace. Devuelve null si
 * no hay ninguna conectada — el caller no debería intentar enriquecer
 * en ese caso (sería un round-trip vacío).
 *
 * Post-055 leemos por workspace_id directo en shopify_connections — una
 * sola query, sin owner_id/workspace_members. Dejamos el fallback por
 * workspace_members como red de seguridad para filas legacy que se
 * hayan perdido el backfill.
 */
export async function resolveShopifyConnection(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ShopifyConnectionForEnrich | null> {
  // Primary path: shopify_connections.workspace_id (migration 055).
  {
    const { data } = await db
      .from('shopify_connections')
      .select('shop_domain, access_token')
      .eq('platform', 'shopify')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .order('installed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as { shop_domain: string; access_token: string } | null;
    if (row) {
      try {
        return {
          shopDomain: row.shop_domain,
          accessToken: decrypt(row.access_token),
          apiVersion: shopifyApiVersion(),
        };
      } catch {
        // fall through to member fallback
      }
    }
  }

  // Belt-and-suspenders fallback: any active connection installed by a
  // workspace_member. Should only ever fire for pre-055 rows whose
  // workspace_id backfill didn't catch them.
  const { data: members } = await db
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId);
  const memberIds = ((members as { user_id: string }[] | null) ?? [])
    .map((m) => m.user_id)
    .filter(Boolean);
  if (memberIds.length === 0) return null;

  const { data } = await db
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('platform', 'shopify')
    .in('user_id', memberIds)
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

/**
 * Punto de entrada principal. Intenta refrescar
 * `contacts.shopify_customer_data` para el contacto dado. Si el cache
 * está fresco (< 24h) y `force=false`, no hace nada y devuelve el cache.
 *
 * Devuelve el snapshot resultante (o null si no hay match en Shopify /
 * no hay conexión / falló la API).
 */
export async function enrichContactFromShopify(
  db: SupabaseClient,
  contact: Contact,
  opts?: { force?: boolean; connection?: ShopifyConnectionForEnrich | null },
): Promise<ShopifyCustomerSnapshot | null> {
  // ── Cache hit ──
  if (!opts?.force && contact.shopify_data_synced_at && contact.shopify_customer_data) {
    const ageMs = Date.now() - new Date(contact.shopify_data_synced_at).getTime();
    if (Number.isFinite(ageMs) && ageMs < CACHE_TTL_MS) {
      return contact.shopify_customer_data;
    }
  }

  if (!contact.phone && !contact.email) return contact.shopify_customer_data ?? null;

  const connection =
    opts?.connection ?? (await resolveShopifyConnection(db, contact.workspace_id));

  // Sin Shopify, la tienda del comercio puede ser Tiendanube o WooCommerce.
  // Antes esto devolvia lo cacheado -casi siempre nada- y la ficha del
  // contacto quedaba vacia para siempre: sin direccion, sin cuanto gasto, sin
  // cuantas veces compro. Eso es lo que el asistente usa para reconocer a
  // quien vuelve.
  if (!connection) {
    const desdeOtraTienda = await enrichContactFromStore(db, contact, opts);
    return desdeOtraTienda ?? contact.shopify_customer_data ?? null;
  }

  try {
    const customer = await findShopifyCustomer(connection, contact);
    if (!customer) {
      // No match — guardamos `null` para no reintentar cada inbound.
      // La próxima ventana de TTL (24h) lo vuelve a chequear.
      await db
        .from('contacts')
        .update({
          shopify_customer_data: null,
          shopify_data_synced_at: new Date().toISOString(),
        })
        .eq('id', contact.id);
      return null;
    }

    const orders = await fetchCustomerOrders(connection, customer.id);
    const snapshot = buildSnapshot(customer, orders);
    await db
      .from('contacts')
      .update({
        shopify_customer_data: snapshot,
        shopify_data_synced_at: new Date().toISOString(),
        is_shopify_customer: true,
      })
      .eq('id', contact.id);
    return snapshot;
  } catch (err) {
    console.error('[contacts/enrich] shopify lookup failed:', err);
    return contact.shopify_customer_data ?? null;
  }
}

async function findShopifyCustomer(
  connection: ShopifyConnectionForEnrich,
  contact: Contact,
): Promise<ShopifyCustomer | null> {
  const base = `https://${connection.shopDomain}/admin/api/${connection.apiVersion}`;
  const headers = {
    'X-Shopify-Access-Token': connection.accessToken,
    'Content-Type': 'application/json',
  };

  const search = async (query: string, limit = 1): Promise<ShopifyCustomer[]> => {
    const r = await fetch(
      `${base}/customers/search.json?query=${encodeURIComponent(query)}&limit=${limit}`,
      { headers },
    );
    // Un 429 (límite de tasa) o un 5xx NO significan "no es cliente". Si los
    // tragáramos devolviendo vacío, el contacto quedaría marcado como
    // revisado-sin-datos y no se volvería a mirar durante días: una tienda
    // ocupada terminaría con media base marcada como "no compró" por un pico
    // de tráfico. Cortamos para que el lote lo reintente.
    if (r.status === 429 || r.status >= 500) {
      throw new Error(`shopify search ${r.status}`);
    }
    if (!r.ok) return [];
    const data = (await r.json()) as { customers?: ShopifyCustomer[] };
    return data.customers ?? [];
  };

  // 1. Email: exacto e indexado, es el match más confiable.
  if (contact.email) {
    const [c] = await search(`email:${contact.email}`);
    if (c) return c;
  }

  if (!contact.phone) return null;

  // 2. Teléfono. `phone:` en Shopify es una comparación literal contra lo que
  //    el cliente cargó, y ahí es donde se perdía la mayoría de los matches:
  //    el mismo argentino es "5493472500967" para WhatsApp y "543472500967"
  //    en Shopify (el 9 de móvil), o está guardado con "+", con 0 de trunk, o
  //    con espacios. Probamos las variantes conocidas antes de rendirnos.
  const digits = normalizePhone(contact.phone);
  const tried = new Set<string>();
  for (const variant of phoneQueryVariants(digits)) {
    if (tried.has(variant)) continue;
    tried.add(variant);
    const [c] = await search(`phone:${variant}`);
    if (c) return c;
  }

  // 3. Último recurso: búsqueda libre por los últimos 8 dígitos, que es lo que
  //    no cambia entre formatos. Es laxa, así que el resultado sólo se acepta
  //    si el teléfono del cliente encontrado REALMENTE coincide — un match
  //    equivocado pegaría la dirección de otra persona en esta ficha, que es
  //    peor que no mostrar nada.
  if (digits.length >= 8) {
    const candidates = await search(digits.slice(-8), 10);
    const hit = candidates.find(
      (c) => c.phone && phonesMatch(c.phone, contact.phone as string),
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * Formas en que el mismo número puede estar cargado en Shopify: E.164 con y
 * sin "+", con y sin 0 de trunk, y —para móviles argentinos— con y sin el 9
 * que WhatsApp exige pero la tienda no suele guardar.
 */
function phoneQueryVariants(digits: string): string[] {
  if (!digits) return [];
  const out = new Set<string>();
  const add = (d: string) => {
    if (!d || d.length < 8) return;
    out.add(d);
    out.add(`+${d}`);
  };
  for (const v of phoneVariants(digits)) add(v);
  // Argentina: 54 9 XXXX… ↔ 54 XXXX…
  if (digits.startsWith('549')) add(`54${digits.slice(3)}`);
  else if (digits.startsWith('54')) add(`549${digits.slice(2)}`);
  return [...out];
}

async function fetchCustomerOrders(
  connection: ShopifyConnectionForEnrich,
  customerId: number,
): Promise<ShopifyOrderLite[]> {
  const base = `https://${connection.shopDomain}/admin/api/${connection.apiVersion}`;
  const headers = {
    'X-Shopify-Access-Token': connection.accessToken,
    'Content-Type': 'application/json',
  };
  const url = `${base}/orders.json?status=any&customer_id=${customerId}&limit=10&fields=${encodeURIComponent('id,name,total_price,created_at,line_items')}`;
  const r = await fetch(url, { headers });
  if (!r.ok) return [];
  const data = (await r.json()) as { orders?: ShopifyOrderLite[] };
  return data.orders ?? [];
}

export function buildSnapshot(
  customer: ShopifyCustomer,
  orders: ShopifyOrderLite[],
): ShopifyCustomerSnapshot {
  const tags = (customer.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const lifetime_orders = orders.slice(0, 10).map((o) => ({
    id: o.id != null ? String(o.id) : undefined,
    name: o.name,
    total_price: o.total_price,
    line_items_titles: (o.line_items ?? []).map((li) => li.title).filter(Boolean),
  }));
  const last_order_date = orders[0]?.created_at ?? null;
  return {
    customer_id: String(customer.id),
    total_spent: Number(customer.total_spent ?? 0) || 0,
    currency: customer.currency ?? undefined,
    orders_count: customer.orders_count ?? orders.length,
    last_order_date,
    tags,
    // La dirección COMPLETA. Antes el snapshot sólo guardaba país y ciudad, así
    // que la ficha del contacto pedía calle, provincia y código postal a un
    // objeto que nunca los tuvo: la dirección no podía verse ni con los datos
    // sincronizados. Es, además, lo que hace falta para despachar un pedido.
    default_address: {
      address1: customer.default_address?.address1 ?? null,
      address2: customer.default_address?.address2 ?? null,
      city: customer.default_address?.city ?? null,
      province: customer.default_address?.province ?? null,
      country: customer.default_address?.country ?? null,
      zip: customer.default_address?.zip ?? null,
    },
    accepts_marketing: !!customer.accepts_marketing,
    lifetime_orders,
  };
}

/** Sólo para los tests: variantes de teléfono con las que se busca en Shopify. */
export const __testing = { phoneQueryVariants };
