import { NextResponse } from 'next/server';
import { cuentaDeLaPrueba } from '@/lib/ai/cuenta-de-prueba';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * Una prueba entera, para verla como chat, y borrarla.
 *
 * GET    /api/ai/probar/sesiones/[id] → { sesion, agentes }
 * DELETE /api/ai/probar/sesiones/[id]
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

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { error } = await admin.from('ai_test_sessions').delete().eq('workspace_id', workspaceId).eq('id', id);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
