import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { ShopifyAdminClient } from '@/lib/shopify/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getActiveShopifyConnection } from '@/lib/attribution/shopify';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET /api/shopify/customer?email=&phone=
 *
 * Busca un cliente en la tienda Shopify del workspace por email o
 * teléfono y devuelve un resumen para el panel de la Bandeja: nombre,
 * LTV (totalSpent), número de órdenes, últimas 5 órdenes con estado
 * de pago/cumplimiento y total.
 *
 * Si la tienda no está conectada, devuelve `{ connected: false }`.
 * Si el cliente no existe, `{ connected: true, customer: null }`.
 *
 * Cache: 60s server-side por (shop, email|phone). Refresco frecuente
 * es innecesario — un cliente no compra dos veces en un minuto.
 */

/**
 * Shopify Admin API customer.state enum. The valid values are:
 * `disabled`, `invited`, `enabled`, `declined` (Shopify Admin REST docs).
 * Anything else coming back is treated as `null`.
 */
type ShopifyCustomerState = 'disabled' | 'invited' | 'enabled' | 'declined';

const VALID_CUSTOMER_STATES: ReadonlySet<ShopifyCustomerState> = new Set([
  'disabled',
  'invited',
  'enabled',
  'declined',
]);

function normalizeCustomerState(
  raw: string | null | undefined,
): ShopifyCustomerState | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  return VALID_CUSTOMER_STATES.has(v as ShopifyCustomerState)
    ? (v as ShopifyCustomerState)
    : null;
}

interface ShopifyCustomer {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  total_spent?: string;
  orders_count?: number;
  currency?: string;
  tags?: string;
  note?: string;
  state?: string;
}

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  order_status_url?: string;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const locale = await getLocale();

  const url = new URL(request.url);
  const email = url.searchParams.get('email')?.trim() ?? '';
  const phone = url.searchParams.get('phone')?.trim() ?? '';
  if (!email && !phone) {
    return NextResponse.json(
      { error: translate(locale, 'errProducts.emailOrPhoneRequired') },
      { status: 400 },
    );
  }

  // Conexión Shopify del workspace. Resolvemos el workspace owner-first
  // (resolveWorkspaceIdForUser) — igual que la instalación y el resto de la
  // app — para que el panel funcione también cuando lo abre un miembro que no
  // es el dueño de la conexión. El legacy `workspace_members` por joined_at
  // resolvía un workspace distinto al que guarda la conexión.
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  const conn = workspaceId
    ? await getActiveShopifyConnection(admin, workspaceId)
    : null;
  if (!conn) {
    return NextResponse.json({ connected: false });
  }
  const client = new ShopifyAdminClient(conn.shopDomain, conn.token);

  // Búsqueda por email tiene endpoint específico; por teléfono usamos
  // el endpoint de search (más flexible). Si ambos fallan, customer = null.
  let customer: ShopifyCustomer | null = null;
  try {
    if (email) {
      const data = await client.rest<{ customers: ShopifyCustomer[] }>(
        `/customers/search.json?query=${encodeURIComponent('email:' + email)}&limit=1`,
      );
      customer = data.customers?.[0] ?? null;
    }
    if (!customer && phone) {
      // Normalizar el teléfono a solo dígitos para la búsqueda.
      const digits = phone.replace(/[^\d]/g, '');
      const data = await client.rest<{ customers: ShopifyCustomer[] }>(
        `/customers/search.json?query=${encodeURIComponent('phone:' + digits)}&limit=1`,
      );
      customer = data.customers?.[0] ?? null;
    }
  } catch {
    return NextResponse.json({ connected: true, customer: null, error: 'lookup_failed' });
  }

  if (!customer) {
    return NextResponse.json({ connected: true, customer: null });
  }

  // Cargar las últimas 5 órdenes del cliente.
  let orders: ShopifyOrder[] = [];
  try {
    const ordersData = await client.rest<{ orders: ShopifyOrder[] }>(
      `/customers/${customer.id}/orders.json?status=any&limit=5`,
    );
    orders = ordersData.orders ?? [];
  } catch {
    // Si falla, devolvemos el customer sin órdenes — mejor que nada.
  }

  return NextResponse.json(
    {
      connected: true,
      shop_domain: conn.shopDomain,
      customer: {
        id: customer.id,
        first_name: customer.first_name ?? '',
        last_name: customer.last_name ?? '',
        email: customer.email ?? '',
        phone: customer.phone ?? '',
        total_spent: customer.total_spent ?? '0.00',
        orders_count: customer.orders_count ?? 0,
        currency: customer.currency ?? '',
        tags: customer.tags ?? '',
        note: customer.note ?? '',
        state: normalizeCustomerState(customer.state),
      },
      orders: orders.map((o) => ({
        id: o.id,
        name: o.name,
        created_at: o.created_at,
        total_price: o.total_price,
        currency: o.currency,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status ?? '',
        order_status_url: o.order_status_url ?? '',
      })),
    },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
