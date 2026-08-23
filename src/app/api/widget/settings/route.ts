import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { widgetSettings } from '@/lib/channels/webchat/config';
import { agenteDelChat } from '@/lib/channels/webchat/connection-store';
import { requireSession } from '@/lib/channels/webchat/guard';

/**
 * GET /api/widget/settings — cómo dibujarse.
 *
 * El cargador ya recibió esto al abrir la sesión, pero pasárselo al iframe por
 * la URL lo dejaría en el historial del navegador y en cualquier captura de
 * pantalla del comercio. El chat lo vuelve a pedir con su propio token, que es
 * un viaje más y ningún dato de más en la barra de direcciones.
 */
export async function GET(request: Request) {
  const guard = await requireSession(request, 'poll');
  if (!guard.ok) return guard.response;

  const { data: workspace } = await supabaseAdmin()
    .from('workspaces')
    .select('name')
    .eq('id', guard.session.workspaceId)
    .maybeSingle();

  return NextResponse.json({
    settings: widgetSettings(
      guard.ctx.config,
      (workspace as { name?: string } | null)?.name ?? 'Riverz',
      // El horario se recalcula en CADA consulta: el chat queda abierto y la
      // hora de cierre pasa mientras la persona escribe.
      await agenteDelChat(guard.session.workspaceId, guard.ctx.config.agent_id ?? null),
    ),
  });
}
