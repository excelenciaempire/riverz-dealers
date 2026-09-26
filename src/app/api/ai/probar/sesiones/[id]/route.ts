import { NextResponse } from 'next/server';
import { cuentaDeLaPrueba } from '@/lib/ai/cuenta-de-prueba';
import { limpiarFeedback } from '@/lib/ai/sesiones-de-prueba';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * Una prueba entera, para verla como chat, marcarla y borrarla.
 *
 * GET    /api/ai/probar/sesiones/[id] → { sesion, agentes }
 * PATCH  /api/ai/probar/sesiones/[id] { feedback }
 * DELETE /api/ai/probar/sesiones/[id]   (sólo el equipo de Riverz)
 *
 * Sólo con sesión: el link compartido escribe pruebas pero no las lee.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const admin = supabaseAdmin();
  const { workspaceId, conSesion } = await cuentaDeLaPrueba(admin, null);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, conSesion ? 'errAi.forbidden' : 'errAi.unauthorized') },
      { status: conSesion ? 403 : 401 }
    );
  }
  const [{ data, error }, { data: agentes }] = await Promise.all([
    admin
      .from('ai_test_sessions')
      .select('id, origen, escenario, canal, detalle, items, feedback, propuestas, mensajes, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle(),
    admin.from('ai_agents').select('id, name').eq('workspace_id', workspaceId).is('deleted_at', null),
  ]);
  if (error) return serverError(error);
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(
    { sesion: data, agentes: agentes ?? [] },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * PATCH /api/ai/probar/sesiones/[id] { feedback } → { feedback }
 *
 * Marcar una prueba ya guardada: quien la revisa después (el equipo, o las
 * pruebas que corrió otro) también puede decir qué estuvo bien y qué no.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await params;
  const locale = await getLocale();
  const admin = supabaseAdmin();
  const { workspaceId, conSesion } = await cuentaDeLaPrueba(admin, null);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, conSesion ? 'errAi.forbidden' : 'errAi.unauthorized') },
      { status: conSesion ? 403 : 401 }
    );
  }
  const body = (await request.json().catch(() => null)) as { feedback?: unknown } | null;
  const { data: fila, error } = await admin
    .from('ai_test_sessions')
    .select('items')
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .maybeSingle();
  if (error) return serverError(error);
  if (!fila) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const items = Array.isArray((fila as { items: unknown }).items) ? ((fila as { items: unknown[] }).items) : [];
  const feedback = limpiarFeedback(body?.feedback, items.length);
  const { error: errGuardar } = await admin
    .from('ai_test_sessions')
    .update({ feedback, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', id);
  if (errGuardar) return serverError(errGuardar);
  return NextResponse.json({ feedback });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await params;
  const locale = await getLocale();
  const admin = supabaseAdmin();
  const { workspaceId, conSesion, equipoRiverz } = await cuentaDeLaPrueba(admin, null);
  if (!workspaceId || !equipoRiverz) {
    return NextResponse.json(
      { error: translate(locale, conSesion ? 'errAi.forbidden' : 'errAi.unauthorized') },
      { status: conSesion ? 403 : 401 }
    );
  }
  const { error } = await admin.from('ai_test_sessions').delete().eq('workspace_id', workspaceId).eq('id', id);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
