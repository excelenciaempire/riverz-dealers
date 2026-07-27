import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, ShopifyCustomerSnapshot } from '@/types';
import {
  buildSnapshot,
  resolveShopifyConnection,
  type ShopifyConnectionForEnrich,
  type ShopifyCustomer,
  type ShopifyOrderLite,
} from './enrich';
import { applyCategoryTags } from './tags';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

/**
 * Sincronización masiva: la lista de clientes de Shopify se trae UNA vez y el
 * emparejamiento se hace acá.
 *
 * El camino anterior preguntaba a Shopify contacto por contacto —hasta diez
 * búsquedas por cabeza probando variantes del teléfono— y eso imponía dos
 * límites que no se podían esquivar: el ritmo de la API (2 pedidos por
 * segundo) obligaba a lotes chicos, y con lotes chicos completar la base
 * llevaba horas. Peor: cada "no encontrado" era una conjetura, porque una
 * búsqueda fallida y un cliente inexistente se ven igual.
 *
 * Con el índice completo en memoria las dos cosas se dan vuelta. Toda la
 * tienda entra en una decena de llamadas, el emparejamiento pasa a ser
 * instantáneo, y un "no está" es una certeza — miramos la lista entera, no el
 * resultado de una búsqueda.
 *
 * Se empareja por email y por los últimos 8 dígitos del teléfono, que es lo
 * único que sobrevive intacto entre formatos: el mismo argentino es
 * "5493472500967" en WhatsApp y "543472500967" en Shopify.
 */

/** Páginas de 250 clientes por corrida. 40 = hasta 10.000 clientes. */
const MAX_CUSTOMER_PAGES = 40;
/** Páginas de 250 pedidos. Alcanzan para el detalle de los últimos ~5.000. */
const MAX_ORDER_PAGES = 20;
/** Tope de contactos actualizados por corrida, para no eternizar el request. */
const MAX_CONTACTS_PER_RUN = 800;
/** Escrituras en paralelo contra la base. */
const WRITE_CONCURRENCY = 8;
/** Cada cuánto se refresca un contacto ya sincronizado. */
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface BulkSyncResult {
  workspace_id: string;
  /** Clientes leídos de Shopify. */
  customers: number;
  /** Contactos evaluados en esta corrida. */
  processed: number;
  /** Emparejados con un cliente (quedan con ficha completa). */
  matched: number;
  /** Sin match: no son clientes de la tienda. Es un dato, no una falla. */
  unmatched: number;
  /** Quedan para la corrida siguiente. */
  pending: number;
  error?: string;
}

/** Índice de la tienda en memoria: por email y por los últimos 8 dígitos. */
interface CustomerIndex {
  byEmail: Map<string, ShopifyCustomer>;
  byPhone: Map<string, ShopifyCustomer>;
  size: number;
}

export async function syncAllWorkspaces(db: SupabaseClient): Promise<BulkSyncResult[]> {
  const { data } = await db
    .from('shopify_connections')
    .select('workspace_id')
    .eq('status', 'active');
  const workspaceIds = [
    ...new Set(
      ((data ?? []) as Array<{ workspace_id: string | null }>)
        .map((r) => r.workspace_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const results: BulkSyncResult[] = [];
  for (const workspaceId of workspaceIds) {
    try {
      results.push(await syncWorkspaceContacts(db, workspaceId));
    } catch (err) {
      results.push({
        workspace_id: workspaceId,
        customers: 0,
        processed: 0,
        matched: 0,
        unmatched: 0,
        pending: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export async function syncWorkspaceContacts(
  db: SupabaseClient,
  workspaceId: string,
): Promise<BulkSyncResult> {
  const empty = (extra: Partial<BulkSyncResult> = {}): BulkSyncResult => ({
    workspace_id: workspaceId,
    customers: 0,
    processed: 0,
    matched: 0,
    unmatched: 0,
    pending: 0,
    ...extra,
  });

  const connection = await resolveShopifyConnection(db, workspaceId);
  if (!connection) return empty({ error: 'sin conexión de Shopify' });

  const staleBefore = new Date(Date.now() - REFRESH_AFTER_MS).toISOString();
  const pendingFilter = `shopify_data_synced_at.is.null,shopify_data_synced_at.lt.${staleBefore}`;

  const { data: rows } = await db
    .from('contacts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .or(pendingFilter)
    .order('shopify_data_synced_at', { ascending: true, nullsFirst: true })
    .limit(MAX_CONTACTS_PER_RUN);
  const contacts = (rows ?? []) as Contact[];
  if (contacts.length === 0) return empty();

  // Un fallo acá (429, token vencido) tiene que CORTAR: sin el índice no se
  // puede afirmar que alguien no es cliente, y marcarlo como revisado sería
  // grabar una mentira que dura una semana.
  const index = await buildCustomerIndex(connection);
  const ordersByCustomer = await fetchOrdersByCustomer(connection);

  const now = new Date().toISOString();
  let matched = 0;
  let unmatched = 0;
  const tagCache = new Map<string, string>();

  await mapWithConcurrency(contacts, WRITE_CONCURRENCY, async (contact) => {
    const customer = lookup(index, contact);
    if (!customer) {
      // Certeza, no conjetura: se revisó la lista completa de la tienda.
      unmatched++;
      await db
        .from('contacts')
        .update({ shopify_customer_data: null, shopify_data_synced_at: now })
        .eq('id', contact.id);
      return;
    }
    const snapshot: ShopifyCustomerSnapshot = buildSnapshot(
      customer,
      ordersByCustomer.get(String(customer.id)) ?? [],
    );
    await db
      .from('contacts')
      .update({
        shopify_customer_data: snapshot,
        shopify_data_synced_at: now,
        is_shopify_customer: true,
      })
      .eq('id', contact.id);
    matched++;
    // Reclasificar con lo que se acaba de traer, para que la etiqueta nunca
    // contradiga a la ficha.
    await applyCategoryTags(
      db,
      workspaceId,
      contact.id,
      {
        ordersCount: Number(snapshot.orders_count ?? 0) || 0,
        // El carrito abandonado lo marca su propio flujo: desde el cliente de
        // Shopify no se distingue y pisarlo borraría un dato cierto.
        isAbandoned: false,
        offerLabel: contact.last_offer_chosen ?? null,
        units: contact.last_offer_units ?? null,
      },
      tagCache,
    ).catch(() => {});
  });

  const { count } = await db
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .or(pendingFilter);

  return {
    workspace_id: workspaceId,
    customers: index.size,
    processed: contacts.length,
    matched,
    unmatched,
    pending: Math.max(0, (count ?? 0) - contacts.length),
  };
}

/** Busca el contacto en el índice: primero email, después teléfono. */
function lookup(index: CustomerIndex, contact: Contact): ShopifyCustomer | null {
  const email = contact.email?.trim().toLowerCase();
  if (email) {
    const hit = index.byEmail.get(email);
    if (hit) return hit;
  }
  const digits = normalizePhone(contact.phone ?? '');
  if (digits.length >= 8) {
    const hit = index.byPhone.get(digits.slice(-8));
    if (hit) return hit;
  }
  return null;
}

async function buildCustomerIndex(
  connection: ShopifyConnectionForEnrich,
): Promise<CustomerIndex> {
  const byEmail = new Map<string, ShopifyCustomer>();
  const byPhone = new Map<string, ShopifyCustomer>();
  let size = 0;

  const fields = [
    'id',
    'email',
    'phone',
    'tags',
    'accepts_marketing',
    'orders_count',
    'total_spent',
    'currency',
    'default_address',
  ].join(',');

  for await (const page of paginate<{ customers?: ShopifyCustomer[] }>(
    connection,
    `customers.json?limit=250&fields=${encodeURIComponent(fields)}`,
    MAX_CUSTOMER_PAGES,
  )) {
    for (const c of page.customers ?? []) {
      size++;
      const email = c.email?.trim().toLowerCase();
      if (email && !byEmail.has(email)) byEmail.set(email, c);
      // El teléfono del cliente y el de su dirección pueden diferir; los dos
      // sirven para reconocerlo.
      for (const raw of [c.phone, (c.default_address as { phone?: string } | null)?.phone]) {
        const digits = normalizePhone(raw ?? '');
        if (digits.length >= 8) {
          const key = digits.slice(-8);
          if (!byPhone.has(key)) byPhone.set(key, c);
        }
      }
    }
  }
  return { byEmail, byPhone, size };
}

/** Pedidos recientes agrupados por cliente, para el detalle de la ficha. */
async function fetchOrdersByCustomer(
  connection: ShopifyConnectionForEnrich,
): Promise<Map<string, ShopifyOrderLite[]>> {
  const out = new Map<string, ShopifyOrderLite[]>();
  const fields = 'name,total_price,created_at,line_items,customer';
  try {
    for await (const page of paginate<{
      orders?: Array<ShopifyOrderLite & { customer?: { id?: number } }>;
    }>(
      connection,
      `orders.json?status=any&limit=250&fields=${encodeURIComponent(fields)}`,
      MAX_ORDER_PAGES,
    )) {
      for (const o of page.orders ?? []) {
        const cid = o.customer?.id ? String(o.customer.id) : '';
        if (!cid) continue;
        const list = out.get(cid) ?? [];
        // El snapshot sólo guarda los 10 más recientes; no acumulamos de más.
        if (list.length < 10) {
          list.push({
            name: o.name,
            total_price: o.total_price,
            created_at: o.created_at,
            line_items: o.line_items,
          });
          out.set(cid, list);
        }
      }
    }
  } catch (err) {
    // El detalle de pedidos es un extra: sin él la ficha igual queda con
    // dirección, gasto y cantidad de pedidos, que es lo que se muestra.
    console.warn('[contacts/bulk-sync] no se pudieron leer los pedidos:', err);
  }
  return out;
}

/**
 * Recorre un endpoint REST paginado de Shopify siguiendo el `Link` header.
 * Lanza ante 429 / 5xx: el caller necesita saber que la lista quedó
 * incompleta en vez de tratarla como la tienda entera.
 */
async function* paginate<T>(
  connection: ShopifyConnectionForEnrich,
  path: string,
  maxPages: number,
): AsyncGenerator<T> {
  const headers = {
    'X-Shopify-Access-Token': connection.accessToken,
    'Content-Type': 'application/json',
  };
  let url: string | null =
    `https://${connection.shopDomain}/admin/api/${connection.apiVersion}/${path}`;
  for (let i = 0; i < maxPages && url; i++) {
    const res: Response = await fetch(url, { headers });
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`shopify ${res.status} en ${path}`);
    }
    if (!res.ok) return;
    yield (await res.json()) as T;
    url = nextPageUrl(res.headers.get('link'));
  }
}

/** `<https://…page_info=abc>; rel="next"` → la URL, o null si no hay más. */
function nextPageUrl(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const [rawUrl, ...rels] = part.split(';');
    if (!rels.some((r) => r.includes('rel="next"'))) continue;
    const m = rawUrl.trim().match(/^<(.+)>$/);
    if (m) return m[1];
  }
  return null;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await fn(items[i]);
      } catch (err) {
        console.error('[contacts/bulk-sync] contacto falló:', err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
}

export const __testing = { nextPageUrl, lookup };
