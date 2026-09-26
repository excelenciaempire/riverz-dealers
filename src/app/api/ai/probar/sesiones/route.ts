import { NextResponse } from 'next/server';
import { cuentaDeLaPrueba } from '@/lib/ai/cuenta-de-prueba';
import {
  contarMensajes,
  limpiarFeedback,
  limpiarItems,
  primerMensaje,
  resumenDeFeedback,
} from '@/lib/ai/sesiones-de-prueba';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';

/**
 * Las pruebas de "Probar como cliente", cada una como un chat
 * (`lib/ai/sesiones-de-prueba`).
 *
 * POST /api/ai/probar/sesiones  — la pantalla guarda la prueba mientras
 *   transcurre, también desde el link compartido (con `token`).
 *   body: { token?, id, escenario, canal, detalle?, items, feedback?, enviar? }
 *   `enviar`: quien probó se la manda al equipo de Riverz, que propone y
 *   aprueba las mejoras desde el panel de plataforma.
 * GET  /api/ai/probar/sesiones  — la lista, sólo con sesión.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const admin = supabaseAdmin();
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    id?: unknown;
    escenario?: unknown;
    canal?: unknown;
    detalle?: unknown;
    items?: unknown;
    feedback?: unknown;
    enviar?: unknown;
  } | null;
  const { workspaceId, compartida, conSesion, userId } = await cuentaDeLaPrueba(admin, body?.token);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, compartida || conSesion ? 'errAi.forbidden' : 'errAi.unauthorized') },
      { status: compartida || conSesion ? 403 : 401 }
    );
  }
  const id = typeof body?.id === 'string' && UUID.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Se guarda con cada mensaje: el cupo es holgado para quien prueba y corta
  // a quien usa el link para llenar la tabla.
  const cupo = await limitByKey(`probar:sesiones:${workspaceId}`, { limit: 240, windowMs: 10 * 60_000 });
  if (!cupo.success) return rateLimitResponse(cupo);

  const items = limpiarItems(body?.items);
  const feedback = limpiarFeedback(body?.feedback, items.length);
  const d = (body?.detalle ?? {}) as Record<string, unknown>;
  const detalle = {
    producto: typeof d.producto === 'string' ? d.producto.slice(0, 200) : null,
    pago: typeof d.pago === 'string' ? d.pago.slice(0, 20) : null,
    primer_mensaje: primerMensaje(items),
  };
  const fila = {
    escenario: typeof body?.escenario === 'string' ? body.escenario.slice(0, 60) : null,
    canal: typeof body?.canal === 'string' ? body.canal.slice(0, 30) : null,
    detalle,
    items,
    feedback,
    mensajes: contarMensajes(items),
    updated_at: new Date().toISOString(),
    ...(body?.enviar === true ? { enviada_at: new Date().toISOString() } : {}),
  };

  const { data: existente } = await admin
    .from('ai_test_sessions')
    .select('workspace_id')
    .eq('id', id)
    .maybeSingle();
  if (existente) {
    if ((existente as { workspace_id: string }).workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const { error } = await admin.from('ai_test_sessions').update(fila).eq('id', id);
    if (error) return serverError(error);
    return NextResponse.json({ ok: true });
  }
  const { error } = await admin.from('ai_test_sessions').insert({
    id,
    workspace_id: workspaceId,
    origen: compartida ? 'link' : 'panel',
    user_id: userId,
    ...fila,
  });
  if (error) return serverError(error);
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function GET() {
  const locale = await getLocale();
  const admin = supabaseAdmin();
  const { workspaceId, conSesion } = await cuentaDeLaPrueba(admin, null);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, conSesion ? 'errAi.forbidden' : 'errAi.unauthorized') },
      { status: conSesion ? 403 : 401 }
    );
  }
  const { data, error } = await admin
    .from('ai_test_sessions')
    .select('id, origen, escenario, canal, detalle, feedback, propuestas, mensajes, enviada_at, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) return serverError(error);
  const sesiones = (data ?? []).map((s) => {
    const fila = s as {
      id: string;
      origen: string;
      escenario: string | null;
      canal: string | null;
      detalle: { primer_mensaje?: string | null; producto?: string | null } | null;
      feedback: unknown;
      propuestas: { reglas?: unknown[]; plataforma?: unknown[] } | null;
      mensajes: number;
      enviada_at: string | null;
      created_at: string;
      updated_at: string;
    };
    return {
      id: fila.id,
      origen: fila.origen,
      escenario: fila.escenario,
      canal: fila.canal,
      primer_mensaje: fila.detalle?.primer_mensaje ?? null,
      producto: fila.detalle?.producto ?? null,
      mensajes: fila.mensajes,
      feedback: resumenDeFeedback(fila.feedback),
      con_propuestas: Boolean(fila.propuestas?.reglas?.length || fila.propuestas?.plataforma?.length),
      enviada_at: fila.enviada_at,
      created_at: fila.created_at,
      updated_at: fila.updated_at,
    };
  });
  return NextResponse.json({ sesiones }, { headers: { 'Cache-Control': 'no-store' } });
}
