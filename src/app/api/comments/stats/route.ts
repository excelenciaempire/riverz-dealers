import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/comments/stats[?workspace_id=&days=30]
 *
 * Lo que hizo Comentarios, y SOLO Comentarios. Cada superficie lleva su propia
 * cuenta: aquí no entra un envío de campaña (Prospección IA) ni una venta que
 * cerró el agente en la bandeja.
 *
 * Tres libros, tres cifras:
 *   comment_to_dm_log    — las reglas del comercio (DM + respuesta pública).
 *   ig_proactive_log     — la IA contestando comentarios (kind='comment').
 *   ig_order_attributions — el dinero, filtrado a source='comment_to_dm'.
 *
 * RLS acota al workspace del usuario; `workspace_id` afina cuando pertenece a
 * más de uno. Todo es mejor-esfuerzo: una cifra que no carga vale 0, nunca
 * rompe la página.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({
      rule_dms: 0,
      public_replies: 0,
      ai_replies: 0,
      revenue: 0,
      currency: 'USD',
    });
  }

  const params = new URL(request.url).searchParams;
  const workspaceId = params.get('workspace_id');
  const days = Math.min(365, Math.max(1, Number(params.get('days')) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const scoped = <T>(q: T): T => {
    const query = q as { eq: (c: string, v: string) => T };
    return workspaceId ? query.eq('workspace_id', workspaceId) : q;
  };

  const [ruleDms, publicReplies, aiReplies, orders] = await Promise.all([
    scoped(
      supabase
        .from('comment_to_dm_log')
        .select('id', { count: 'exact', head: true })
        .eq('dm_status', 'sent')
        .gte('created_at', since),
    ),
    scoped(
      supabase
        .from('comment_to_dm_log')
        .select('id', { count: 'exact', head: true })
        .eq('public_reply_status', 'sent')
        .gte('created_at', since),
    ),
    scoped(
      supabase
        .from('ig_proactive_log')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'comment')
        .gte('created_at', since),
    ),
    scoped(
      supabase
        .from('ig_order_attributions')
        .select('revenue, currency')
        .eq('source', 'comment_to_dm')
        .gte('created_at', since),
    ),
  ]);

  const orderRows = (orders.data ?? []) as Array<{
    revenue: number | null;
    currency: string | null;
  }>;

  return NextResponse.json({
    rule_dms: ruleDms.count ?? 0,
    public_replies: publicReplies.count ?? 0,
    ai_replies: aiReplies.count ?? 0,
    revenue: orderRows.reduce((s, o) => s + (Number(o.revenue) || 0), 0),
    currency: orderRows.find((o) => o.currency)?.currency ?? 'USD',
    days,
  });
}
