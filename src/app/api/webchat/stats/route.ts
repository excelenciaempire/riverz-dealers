import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

/**
 * Qué está haciendo el chat web, en números.
 *
 * Las cinco cifras que importan y por qué esas:
 *   conversaciones  — cuánta gente habló.
 *   resueltas       — terminaron sin que una persona tuviera que entrar. Es la
 *                     medida real de si el agente sirve.
 *   escaladas       — las que sí necesitaron a alguien del equipo.
 *   pedidos         — compras que salieron de una de esas conversaciones.
 *   ingreso         — cuánto dinero fue eso, separado por divisa.
 *
 * "Resuelta" se deriva, no se guarda: una conversación de chat web que nadie
 * del equipo tocó y que no pidió humano, la resolvió el agente. Guardar un
 * estado aparte obligaría a alguien a mantenerlo, y nadie lo haría.
 *
 * Los pedidos salen de `orders` filtrando por canal, que es donde los deja la
 * atribución (`attributeWebchatOrder`). No hay tabla de métricas: el dato ya
 * está, sólo hay que contarlo.
 */

const WINDOW_DAYS = 30;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return NextResponse.json({ error: 'no_workspace' }, { status: 404 });

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [conversationsRes, ordersRes] = await Promise.all([
    admin
      .from('conversations')
      .select('id, status, assigned_agent_id, needs_human_at')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'webchat')
      .is('deleted_at', null)
      .gte('created_at', since),
    admin
      .from('orders')
      .select('total_price, currency, status')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'webchat')
      .gte('created_at', since),
  ]);

  const conversations = (conversationsRes.data ?? []) as Array<{
    status: string | null;
    assigned_agent_id: string | null;
    needs_human_at: string | null;
  }>;
  const orders = (ordersRes.data ?? []) as Array<{
    total_price: number | string | null;
    currency: string | null;
    status: string | null;
  }>;

  const escalated = conversations.filter(
    (c) => Boolean(c.needs_human_at) || Boolean(c.assigned_agent_id),
  ).length;

  // Un pedido cancelado o que nunca se pudo crear no es ingreso: contarlo
  // infla justo el número que el comercio va a usar para decidir si el canal
  // vale la pena. (`orders.status` sólo admite created|paid|fulfilled|
  // cancelled|failed — no hay 'refunded' que filtrar.)
  //
  // Y se agrupa por divisa. Antes se sumaba todo junto y al total se le pegaba
  // la divisa del primer pedido de la lista: una tienda que vende en pesos y
  // en dólares veía 1.250.000 "USD", un número que no existe.
  const porDivisa = new Map<string, { revenue: number; orders: number }>();
  for (const o of orders) {
    if (o.status === 'cancelled' || o.status === 'failed') continue;
    const n =
      typeof o.total_price === 'number' ? o.total_price : parseFloat(String(o.total_price ?? ''));
    if (!Number.isFinite(n)) continue;
    const code = (o.currency ?? '').trim().toUpperCase();
    const acc = porDivisa.get(code) ?? { revenue: 0, orders: 0 };
    acc.revenue += n;
    acc.orders += 1;
    porDivisa.set(code, acc);
  }
  const revenueByCurrency = [...porDivisa.entries()]
    .map(([currency, v]) => ({ currency: currency || null, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  // `revenue` + `currency` siguen siendo la divisa que más movió, no la mezcla:
  // la tarjeta de Ajustes muestra ese par y con una sola divisa —el caso
  // normal— da exactamente lo mismo que antes.
  const principal = revenueByCurrency[0] ?? null;

  return NextResponse.json({
    period_days: WINDOW_DAYS,
    conversations: conversations.length,
    resolved: conversations.length - escalated,
    escalated,
    orders: orders.length,
    revenue: principal?.revenue ?? 0,
    currency: principal?.currency ?? null,
    revenue_by_currency: revenueByCurrency,
  });
}
