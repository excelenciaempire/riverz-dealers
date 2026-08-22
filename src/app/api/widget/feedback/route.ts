import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { requireSession } from '@/lib/channels/webchat/guard';

/**
 * POST /api/widget/feedback — ¿sirvió?
 *
 * "300 conversaciones" no dice nada. "300 conversaciones y el 82% quedó
 * conforme" es el número con el que un comercio decide si el canal se queda, y
 * el único que distingue un agente que resuelve de uno que sólo contesta.
 *
 * Se pregunta UNA vez por conversación y se puede cambiar de opinión: quien
 * marca "no" y después consigue lo que quería tiene que poder corregirlo, o el
 * número mide el peor momento y no el resultado.
 */
export async function POST(request: Request) {
  const guard = await requireSession(request, 'identify');
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const body = (await request.json().catch(() => null)) as {
    util?: unknown;
    comentario?: unknown;
  } | null;
  if (typeof body?.util !== 'boolean') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  // La conversación sale del token, nunca del cuerpo: el visitante no elige
  // cuál califica.
  const { data: contact } = await admin
    .from('contacts')
    .select('id')
    .eq('workspace_id', session.workspaceId)
    .eq('channel', 'webchat')
    .eq('external_id', session.visitorId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ ok: true, saved: false });

  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('workspace_id', session.workspaceId)
    .eq('contact_id', (contact as { id: string }).id)
    .eq('channel', 'webchat')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conv) return NextResponse.json({ ok: true, saved: false });

  const comentario =
    typeof body.comentario === 'string' ? body.comentario.trim().slice(0, 500) : null;

  const { error } = await admin
    .from('conversations')
    .update({
      csat: body.util ? 1 : -1,
      csat_at: new Date().toISOString(),
      ...(comentario ? { csat_comment: comentario } : {}),
    })
    .eq('id', (conv as { id: string }).id)
    .eq('workspace_id', session.workspaceId);
  if (error) return NextResponse.json({ error: 'update_failed' }, { status: 502 });

  return NextResponse.json({ ok: true, saved: true });
}
