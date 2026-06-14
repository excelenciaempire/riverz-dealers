import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { ShopifyAdminClient } from '@/lib/shopify/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

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

  const url = new URL(request.url);
  const email = url.searchParams.get('email')?.trim() ?? '';
  const phone = url.searchParams.get('phone')?.trim() ?? '';
  if (!email && !phone) {
    return NextResponse.json({ error: 'email o phone requerido' }, { status: 400 });
  }

  // Cargar la conexión Shopify del workspace (la primera activa).
  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from('shopify_connections')
    .select('shop_domain, access_token, status')
    .eq('user_id', user.id)
    .eq('status', 'connected')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ connected: false });
  }
  const conn = row as { shop_domain: string; access_token: string };
  const token = (() => {
    try {
      return decrypt(conn.access_token);
    } catch {
      return null;
    }
  })();
  if (!token) {
    return NextResponse.json({ connected: false });
  }
  const client = new ShopifyAdminClient(conn.shop_domain, token);

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
      shop_domain: conn.shop_domain,
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
