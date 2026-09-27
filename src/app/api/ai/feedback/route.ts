import { NextResponse } from 'next/server';
import { capturaHasta, admiteFeedbackReal } from '@/lib/ai/feedback-real';
import { serverError } from '@/lib/api/errors';
import { csrfGuard } from '@/lib/csrf';
import { cuentaDeSesion } from '@/lib/workspaces/cuenta-de-sesion';

/**
 * El feedback del equipo sobre respuestas automáticas reales (la bandeja).
 *
 * GET  /api/ai/feedback?conversation_id=  → { marcas: { [message_id]: { voto, nota } } }
 *      lo propio en ese hilo, para pintar las burbujas.
 * GET  /api/ai/feedback                   → { feedback, lotes, automaticas }
 *      todo el del comercio, con su captura, y las mejoras propuestas.
 * POST /api/ai/feedback { message_id, voto, nota }
 *      guarda o borra (sin voto ni nota) lo que opina quien tiene la sesión.
 */

export async function GET(request: Request) {
  const c = await cuentaDeSesion();
  if ('error' in c) return c.error;
  const { admin, workspaceId, userId } = c;
  const conversacion = new URL(request.url).searchParams.get('conversation_id');

  if (conversacion) {
    const { data, error } = await admin
      .from('ai_feedback')
      .select('message_id, voto, nota')
      .eq('workspace_id', workspaceId)
      .eq('conversation_id', conversacion)
      .eq('user_id', userId);
    if (error) return serverError(error);
    const marcas = Object.fromEntries(
      ((data ?? []) as Array<{ message_id: string; voto: string | null; nota: string }>).map((f) => [
        f.message_id,
        { voto: f.voto, nota: f.nota },
      ])
    );
    return NextResponse.json({ marcas }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const [{ data: feedback, error }, { data: lotes }, { data: ws }, { data: agentes }] = await Promise.all([
    admin
      .from('ai_feedback')
      .select('id, conversation_id, message_id, agent_id, canal, voto, nota, captura, estado, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(150),
    admin
      .from('ai_mejoras_lotes')
      .select('id, feedback_ids, propuestas, automatico, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('workspaces').select('mejoras_automaticas').eq('id', workspaceId).maybeSingle(),
    admin.from('ai_agents').select('id, name').eq('workspace_id', workspaceId).is('deleted_at', null),
  ]);
  if (error) return serverError(error);
  return NextResponse.json(
    {
      feedback: feedback ?? [],
      lotes: lotes ?? [],
      agentes: agentes ?? [],
      automaticas: (ws as { mejoras_automaticas?: boolean } | null)?.mejoras_automaticas === true,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuentaDeSesion();
  if ('error' in c) return c.error;
  const { admin, workspaceId, userId } = c;
  const body = (await request.json().catch(() => null)) as { message_id?: unknown; voto?: unknown; nota?: unknown } | null;
  const messageId = typeof body?.message_id === 'string' ? body.message_id : '';
  if (!messageId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const voto = body?.voto === 'bien' || body?.voto === 'mal' ? body.voto : null;
  const nota = typeof body?.nota === 'string' ? body.nota.trim().slice(0, 1000) : '';

  const { data: mensaje } = await admin
    .from('messages')
    .select('id, conversation_id, created_at, sender_type, sender_id, origin, channel, conversations!inner(workspace_id, assigned_ai_agent_id)')
    .eq('id', messageId)
    .eq('conversations.workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle();
  const m = mensaje as {
    id: string;
    conversation_id: string;
    created_at: string;
    sender_type: string | null;
    sender_id: string | null;
    origin: string | null;
    channel: string | null;
    conversations: { assigned_ai_agent_id?: string | null } | null;
  } | null;
  if (!m) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!admiteFeedbackReal(m)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  if (!voto && !nota) {
    const { error } = await admin
      .from('ai_feedback')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('message_id', messageId)
      .eq('user_id', userId);
    if (error) return serverError(error);
    return NextResponse.json({ ok: true });
  }

  const captura = await capturaHasta(admin, m.conversation_id, m);
  const { error } = await admin.from('ai_feedback').upsert(
    {
      workspace_id: workspaceId,
      conversation_id: m.conversation_id,
      message_id: messageId,
      agent_id: m.conversations?.assigned_ai_agent_id ?? null,
      user_id: userId,
      canal: m.channel,
      voto,
      nota,
      captura,
      // Cambiar lo que se opinó vuelve a ponerlo en la fila de lo nuevo.
      estado: 'nuevo',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'message_id,user_id' }
  );
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
