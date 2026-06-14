import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { ShopifyAdminClient } from '@/lib/shopify/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * GET /api/analytics/attribution?days=30
 *
 * Atribuye revenue de Shopify a campañas y flujos del workspace en
 * los últimos `days` días. La lógica es directa: una orden cuenta
 * para una campaña / flujo si dentro de las 24h previas al pedido
 * hubo una interacción enviada o recibida en esa conversación que
 * el flujo / la campaña disparó.
 *
 * Output:
 *   {
 *     days,
 *     by_broadcast: [{ id, name, orders_count, revenue, currency }],
 *     by_flow:      [{ id, name, orders_count, revenue, currency }]
 *   }
 *
 * Limit por simplicidad: solo cuenta órdenes con `email` o `phone`
 * que matchea con un contacto del workspace. Si Shopify no devuelve
 * email/phone, esa orden queda fuera de la atribución.
 */

interface ShopifyOrder {
  id: number;
  email?: string;
  phone?: string;
  total_price?: string;
  currency?: string;
  created_at: string;
}

interface FlowAttrRow {
  id: string;
  name: string;
  orders_count: number;
  revenue: number;
  currency: string;
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
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') ?? '30')));
  const since = new Date(Date.now() - days * 86_400_000);
  const sinceIso = since.toISOString();

  const admin = supabaseAdmin();

  // 1) Shopify connection.
  const { data: connRow } = await admin
    .from('shopify_connections')
    .select('shop_domain, access_token, status')
    .eq('user_id', user.id)
    .eq('status', 'connected')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!connRow) {
    return NextResponse.json({
      days,
      by_broadcast: [],
      by_flow: [],
      not_connected: true,
    });
  }
  const conn = connRow as { shop_domain: string; access_token: string };
  const token = (() => {
    try {
      return decrypt(conn.access_token);
    } catch {
      return null;
    }
  })();
  if (!token) {
    return NextResponse.json({
      days,
      by_broadcast: [],
      by_flow: [],
      not_connected: true,
    });
  }

  // 2) Órdenes recientes desde Shopify.
  const client = new ShopifyAdminClient(conn.shop_domain, token);
  let orders: ShopifyOrder[] = [];
  try {
    const data = await client.rest<{ orders: ShopifyOrder[] }>(
      `/orders.json?status=any&created_at_min=${encodeURIComponent(sinceIso)}&limit=250`,
    );
    orders = data.orders ?? [];
  } catch {
    return NextResponse.json({
      days,
      by_broadcast: [],
      by_flow: [],
      error: 'shopify_fetch_failed',
    });
  }

  if (orders.length === 0) {
    return NextResponse.json({ days, by_broadcast: [], by_flow: [] });
  }

  // 3) Match cada orden con un contact (por email o phone).
  const emails = Array.from(
    new Set(orders.map((o) => o.email).filter((x): x is string => !!x)),
  );
  const phones = Array.from(
    new Set(orders.map((o) => normPhone(o.phone)).filter((x): x is string => !!x)),
  );
  const { data: contactsByEmail } = await admin
    .from('contacts')
    .select('id, email, phone')
    .in('email', emails.length > 0 ? emails : ['__none__']);
  const { data: contactsByPhone } = await admin
    .from('contacts')
    .select('id, email, phone')
    .in('phone', phones.length > 0 ? phones : ['__none__']);

  const emailToContact = new Map<string, string>();
  for (const c of contactsByEmail ?? []) {
    const row = c as { id: string; email?: string };
    if (row.email) emailToContact.set(row.email.toLowerCase(), row.id);
  }
  const phoneToContact = new Map<string, string>();
  for (const c of contactsByPhone ?? []) {
    const row = c as { id: string; phone?: string };
    if (row.phone) phoneToContact.set(normPhone(row.phone) ?? '', row.id);
  }

  // 4) Por cada orden, buscamos su contacto y la conversación.
  //    Después atribuimos a la última broadcast_recipients que
  //    le mandó algo en las 24h previas, y al último flow_run.
  const byBroadcast = new Map<string, FlowAttrRow>();
  const byFlow = new Map<string, FlowAttrRow>();

  for (const order of orders) {
    const cId =
      (order.email && emailToContact.get(order.email.toLowerCase())) ||
      (order.phone && phoneToContact.get(normPhone(order.phone) ?? '')) ||
      null;
    if (!cId) continue;

    const orderTime = new Date(order.created_at).getTime();
    const lookback = new Date(orderTime - 86_400_000).toISOString();
    const total = Number(order.total_price ?? '0');
    const currency = order.currency || 'USD';

    // Last broadcast send to this contact in the lookback window.
    const { data: bcRow } = await admin
      .from('broadcast_recipients')
      .select('broadcast_id, broadcasts(name)')
      .eq('contact_id', cId)
      .gte('sent_at', lookback)
      .lte('sent_at', order.created_at)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bcRow) {
      const row = bcRow as { broadcast_id: string; broadcasts: { name?: string } | { name?: string }[] };
      const join = Array.isArray(row.broadcasts) ? row.broadcasts[0] : row.broadcasts;
      const name = join?.name ?? 'Campaña';
      const cur = byBroadcast.get(row.broadcast_id) ?? {
        id: row.broadcast_id,
        name,
        orders_count: 0,
        revenue: 0,
        currency,
      };
      cur.orders_count += 1;
      cur.revenue += total;
      byBroadcast.set(row.broadcast_id, cur);
    }

    // Last flow run for this contact in the lookback window.
    const { data: frRow } = await admin
      .from('flow_runs')
      .select('flow_id, flows(name)')
      .eq('contact_id', cId)
      .gte('started_at', lookback)
      .lte('started_at', order.created_at)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (frRow) {
      const row = frRow as { flow_id: string; flows: { name?: string } | { name?: string }[] };
      const join = Array.isArray(row.flows) ? row.flows[0] : row.flows;
      const name = join?.name ?? 'Flujo';
      const cur = byFlow.get(row.flow_id) ?? {
        id: row.flow_id,
        name,
        orders_count: 0,
        revenue: 0,
        currency,
      };
      cur.orders_count += 1;
      cur.revenue += total;
      byFlow.set(row.flow_id, cur);
    }
  }

  return NextResponse.json({
    days,
    by_broadcast: Array.from(byBroadcast.values()).sort(
      (a, b) => b.revenue - a.revenue,
    ),
    by_flow: Array.from(byFlow.values()).sort((a, b) => b.revenue - a.revenue),
  });
}

function normPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/[^\d]/g, '');
  return d.length >= 8 ? d : null;
}
