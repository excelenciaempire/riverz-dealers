import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { requireSession } from '@/lib/channels/webchat/guard';
import { conversacionDelVisitante } from '@/lib/channels/webchat/conversacion';
import { pedirHumano } from '@/lib/inbox/conversaciones';

/**
 * POST /api/widget/handoff — "quiero hablar con una persona".
 *
 * Escalar ya existía por seis caminos y todos los decidía el sistema: una
 * palabra clave que el comercio configuró, el cupo de respuestas, un flujo, el
 * cortacircuitos, una aprobación que no llegó, o el agente reconociendo que no
 * sabía. Ninguno era un pedido explícito, así que quien quería una persona
 * tenía que acertarle a la palabra mágica — y el que no le acertaba se quedaba
 * discutiendo con un bot.
 *
 * Apaga la IA en ESE hilo y lo deja en 'pending' con el motivo, que es lo que
 * lo hace aparecer en el filtro "necesita humano" de la bandeja. No manda un
 * mensaje: el aviso de que alguien va a contestar lo dibuja el chat, y una fila
 * más en el hilo sólo agrega ruido a lo que después lee la persona.
 */
export async function POST(request: Request) {
  const guard = await requireSession(request, 'identify');
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const conversacion = await conversacionDelVisitante(session.workspaceId, session.visitorId);
  // Todavía no escribió nada: no hay hilo que pasarle a nadie. Para el widget
  // es un éxito igual — el botón sólo aparece cuando ya hubo conversación, así
  // que llegar acá sin hilo es una carrera, no un error que mostrarle.
  if (!conversacion) return NextResponse.json({ ok: true, escalado: false });

  const { error } = await pedirHumano(supabaseAdmin(), {
    workspaceId: session.workspaceId,
    conversationId: conversacion.id,
    motivo: 'visitor_request',
  });
  if (error) return NextResponse.json({ error: 'update_failed' }, { status: 502 });

  return NextResponse.json({ ok: true, escalado: true });
}
