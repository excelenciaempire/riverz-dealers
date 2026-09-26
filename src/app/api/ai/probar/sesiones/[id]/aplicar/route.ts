import { NextResponse } from 'next/server';
import { cuentaDeLaPrueba } from '@/lib/ai/cuenta-de-prueba';
import { MAX_REGLAS } from '@/lib/ai/guidance';
import type { Propuestas } from '@/lib/ai/sesiones-de-prueba';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * POST /api/ai/probar/sesiones/[id]/aplicar
 *   body: { indice, titulo?, cuando?, hacer? } → { propuestas }
 *
 * Aplica una regla propuesta, con lo que haya corregido quien la revisó:
 * edita la regla existente o crea una nueva. La propuesta queda marcada como
 * aplicada para no aplicarla dos veces.
 */
const MAX_TITULO = 80;
const MAX_CUANDO = 500;
const MAX_HACER = 1500;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const body = (await request.json().catch(() => null)) as {
    indice?: unknown;
    titulo?: unknown;
    cuando?: unknown;
    hacer?: unknown;
  } | null;

  const { data: fila, error } = await admin
    .from('ai_test_sessions')
    .select('propuestas')
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .maybeSingle();
  if (error) return serverError(error);
  const propuestas = (fila as { propuestas: Propuestas | null } | null)?.propuestas;
  const indice = Number(body?.indice);
  const propuesta = Number.isSafeInteger(indice) ? propuestas?.reglas?.[indice] : undefined;
  if (!propuestas || !propuesta) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (propuesta.aplicada) return NextResponse.json({ propuestas });

  const texto = (v: unknown, fallback: string, max: number) =>
    (typeof v === 'string' ? v : fallback).trim().slice(0, max);
  const titulo = texto(body?.titulo, propuesta.titulo, MAX_TITULO);
  const cuando = texto(body?.cuando, propuesta.cuando, MAX_CUANDO) || null;
  const hacer = texto(body?.hacer, propuesta.hacer, MAX_HACER);
  if (!titulo || !hacer) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  if (propuesta.accion === 'editar' && propuesta.regla_id) {
    const { data, error: errEditar } = await admin
      .from('agent_guidance')
      .update({ titulo, cuando, hacer, activa: true, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', propuesta.regla_id)
      .select('id')
      .maybeSingle();
    if (errEditar) return serverError(errEditar);
    if (!data) return NextResponse.json({ error: translate(locale, 'assistant.pruebasReglaNoExiste') }, { status: 404 });
  } else {
    // Al prompt de cada asistente entran como mucho MAX_REGLAS (las de todos
    // más las suyas): una regla que queda afuera es una promesa que no pasa.
    const { data: activas } = await admin
      .from('agent_guidance')
      .select('agent_id')
      .eq('workspace_id', workspaceId)
      .eq('activa', true);
    const lista = (activas ?? []) as Array<{ agent_id: string | null }>;
    const globales = lista.filter((r) => r.agent_id === null).length;
    const propias = (agente: string) => lista.filter((r) => r.agent_id === agente).length;
    const afectados = propuesta.agente_id
      ? [propuesta.agente_id]
      : [...new Set(lista.map((r) => r.agent_id).filter((a): a is string => a !== null))];
    const lleno = propuesta.agente_id
      ? globales + propias(propuesta.agente_id) >= MAX_REGLAS
      : globales >= MAX_REGLAS || afectados.some((a) => globales + propias(a) >= MAX_REGLAS);
    if (lleno) {
      return NextResponse.json(
        { error: translate(locale, 'assistant.pruebasTopeReglas', { n: MAX_REGLAS }) },
        { status: 409 }
      );
    }
    const { data: ultima } = await admin
      .from('agent_guidance')
      .select('orden')
      .eq('workspace_id', workspaceId)
      .order('orden', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error: errCrear } = await admin.from('agent_guidance').insert({
      workspace_id: workspaceId,
      agent_id: propuesta.agente_id,
      titulo,
      cuando,
      hacer,
      activa: true,
      orden: ((ultima as { orden?: number } | null)?.orden ?? 0) + 1,
      origen: 'comercio',
    });
    if (errCrear) return serverError(errCrear);
  }

  const nuevas: Propuestas = {
    ...propuestas,
    reglas: propuestas.reglas.map((r, i) => (i === indice ? { ...r, titulo, cuando: cuando ?? '', hacer, aplicada: true } : r)),
  };
  const { error: errGuardar } = await admin
    .from('ai_test_sessions')
    .update({ propuestas: nuevas })
    .eq('workspace_id', workspaceId)
    .eq('id', id);
  if (errGuardar) return serverError(errGuardar);
  return NextResponse.json({ propuestas: nuevas });
}
