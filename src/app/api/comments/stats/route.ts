import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Antes esto devolvía por qué NO iba a contestar nadie: sin asistente, con el
 * asistente pausado, o con un alcance que excluía los comentarios. Ese aviso
 * dejó de tener sentido cuando Comentarios dejó de pedirle permiso al agente:
 * ahora contesta con su propio interruptor, y sin agente lo hace igual con la
 * marca y el catálogo (lo que pierde son las herramientas).
 *
 * Un aviso que manda al usuario a otra sección para arreglar algo que ya no
 * está roto es peor que no tener aviso.
 */

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
 * más de uno. Si falla la lectura, el cliente conserva el último dato válido
 * y reintenta sin presentar ceros como actividad confirmada.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ dms_sent: 0, public_replies: 0 });
  }

  const params = new URL(request.url).searchParams;
  const workspaceId = params.get('workspace_id');
  const days = Math.min(365, Math.max(1, Number(params.get('days')) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const scoped = <T>(q: T): T => {
    const query = q as { eq: (c: string, v: string) => T };
    return workspaceId ? query.eq('workspace_id', workspaceId) : q;
  };

  // Dos cifras, las dos cosas que de verdad pasaron. Ya NO se reparten por
  // quién las hizo (IA o regla): eso es un detalle de cómo funciona por dentro
  // y al comercio le da igual quién escribió — le importa cuánto salió.
  //
  // Los DMs se cuentan SOLO en ig_proactive_log: las reglas también escriben en
  // comment_to_dm_log y sumar las dos tablas los contaría dos veces.
  const [dmsSent, aiPublic, rulePublic] = await Promise.all([
    scoped(
      supabase
        .from('ig_proactive_log')
        .select('id', { count: 'exact', head: true })
        .in('kind', ['comment', 'comment_rule'])
        .gte('created_at', since),
    ),
    scoped(
      supabase
        .from('ig_proactive_log')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'comment_public')
        .gte('created_at', since),
    ),
    scoped(
      supabase
        .from('comment_to_dm_log')
        .select('id', { count: 'exact', head: true })
        .eq('public_reply_status', 'sent')
        .gte('created_at', since),
    ),
  ]);

  // Un fallo de lectura no es cero actividad. El cliente conserva el último
  // dato válido y reintenta en la próxima actualización.
  if (dmsSent.error || aiPublic.error || rulePublic.error) {
    return NextResponse.json({ error: 'comment_stats_unavailable' }, { status: 503 });
  }
  return NextResponse.json({
    dms_sent: dmsSent.count ?? 0,
    public_replies: (aiPublic.count ?? 0) + (rulePublic.count ?? 0),
    days,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
