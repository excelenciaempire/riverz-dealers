import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';

/**
 * Pedidos creados por el asistente IA (tabla `orders`, migración 080).
 *
 *   GET — devuelve los últimos pedidos del workspace para la página
 *         /pedidos. La RLS de `orders` ya limita el SELECT a miembros del
 *         workspace; igual resolvemos el workspace del usuario para
 *         filtrar de forma explícita.
 *
 * Los pedidos se CREAN desde el runner (tool create_order) con el cliente
 * de servicio; no hay escritura desde el navegador.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'Sin workspace' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, created_at, order_number, order_status_url, currency, total_price, line_items, customer_name, customer_phone, payment_method, financial_status, fulfillment_status, status, channel, agent_id',
    )
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json(
      { error: 'No se pudieron cargar los pedidos' },
      { status: 500 },
    );
  }

  return NextResponse.json({ orders: data ?? [] });
}
