import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/ai/instagram-agent/attributed-orders
 *
 * The Instagram order-attribution ledger (migration 094): orders that happened
 * thanks to the engine, with their source + revenue. RLS scopes to the caller's
 * workspace.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ orders: [], total_revenue: 0, count: 0 });

  const { data } = await supabase
    .from('ig_order_attributions')
    .select('shopify_order_id, order_name, source, revenue, currency, channel, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const orders = (data ?? []) as Array<{
    shopify_order_id: string;
    order_name: string | null;
    source: string;
    revenue: number | null;
    currency: string | null;
    channel: string | null;
    created_at: string;
  }>;
  const total_revenue = orders.reduce((s, o) => s + (Number(o.revenue) || 0), 0);
  const currency = orders.find((o) => o.currency)?.currency ?? 'USD';

  return NextResponse.json({
    orders,
    total_revenue,
    currency,
    count: orders.length,
  });
}
