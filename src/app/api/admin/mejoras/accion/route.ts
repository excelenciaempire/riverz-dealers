import { NextResponse } from 'next/server';
import { recordAdminAction, type AdminAction } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/admin/guard';
import { aplicarReglaPropuesta } from '@/lib/ai/mejoras';
import { mejorarFeedbackReal, mejorarSesionDePrueba } from '@/lib/ai/mejoras-de-pruebas';
import type { Propuestas } from '@/lib/ai/sesiones-de-prueba';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { aprobarCambio, descartarCambio } from '@/lib/templates/cambios';

export const dynamic = 'force-dynamic';

/**
 * Lo que el equipo de Riverz aprueba desde Pruebas y feedback. El comercio
 * sólo comenta y envía; acá se proponen las mejoras, se aplican y se aprueban
 * los cambios de plantilla.
 *
 * POST /api/admin/mejoras/accion?que=<acción>&id=<id>
 *   proponer-prueba   id = prueba            → { propuestas }
 *   aplicar-prueba    id = prueba, body { indice, titulo?, cuando?, hacer? } → { propuestas }
 *   proponer-real     id = comercio          → { lote } | { sin_feedback }
 *   aplicar-lote      id = lote, body como aplicar-prueba → { propuestas }
 *   aprobar-cambio    id = cambio de plantilla → { nueva } | { error }
 *   descartar-cambio  id = cambio de plantilla → { ok }
 *   borrar-prueba     id = prueba            → { ok }
 *   borrar-pruebas    id = comercio          → { ok }
 */
export async function POST(request: Request) {
  const csrf = await csrfGuard(request);
  if (csrf) return csrf;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.res;

  const url = new URL(request.url);
  const que = url.searchParams.get('que') ?? '';
  const id = url.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const db = supabaseAdmin();
  const body = (await request.json().catch(() => ({}))) as { indice?: unknown; titulo?: unknown; cuando?: unknown; hacer?: unknown };

  const auditar = (meta: Record<string, unknown>) =>
    recordAdminAction(auth.actor, request, {
      action: `update.mejora.${que}` as AdminAction,
      targetType: que.endsWith('cambio')
        ? 'cambios_de_plantilla'
        : que.startsWith('borrar')
          ? 'ai_test_sessions'
          : 'mejoras',
      targetId: id,
      meta,
    }).catch(() => {});

  if (que === 'proponer-prueba' || que === 'aplicar-prueba') {
    const { data: fila } = await db.from('ai_test_sessions').select('workspace_id, propuestas').eq('id', id).maybeSingle();
    const sesion = fila as { workspace_id: string; propuestas: Propuestas | null } | null;
    if (!sesion) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (que === 'proponer-prueba') {
      const r = await mejorarSesionDePrueba(db, sesion.workspace_id, id);
      if (typeof r === 'string') return NextResponse.json({ error: r }, { status: r === 'fallo' ? 502 : 400 });
      await auditar({ workspaceId: sesion.workspace_id });
      return NextResponse.json({ propuestas: r });
    }
    return aplicar(db, 'ai_test_sessions', id, sesion.workspace_id, sesion.propuestas, body, auditar);
  }

  if (que === 'proponer-real') {
    const r = await mejorarFeedbackReal(db, id, { automatico: false });
    if (r === 'sin_feedback') return NextResponse.json({ sin_feedback: true });
    if (r === 'fallo') return NextResponse.json({ error: 'fallo' }, { status: 502 });
    await auditar({ workspaceId: id });
    return NextResponse.json({ lote: r });
  }

  if (que === 'aplicar-lote') {
    const { data: fila } = await db.from('ai_mejoras_lotes').select('workspace_id, propuestas').eq('id', id).maybeSingle();
    const lote = fila as { workspace_id: string; propuestas: Propuestas | null } | null;
    if (!lote) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return aplicar(db, 'ai_mejoras_lotes', id, lote.workspace_id, lote.propuestas, body, auditar);
  }

  if (que === 'aprobar-cambio') {
    const r = await aprobarCambio(db, id);
    await auditar({ ok: r.ok });
    return r.ok ? NextResponse.json({ nueva: r.nueva }) : NextResponse.json({ error: r.motivo }, { status: 422 });
  }

  if (que === 'descartar-cambio') {
    await descartarCambio(db, id);
    await auditar({});
    return NextResponse.json({ ok: true });
  }

  if (que === 'borrar-prueba' || que === 'borrar-pruebas') {
    const { error } = await db
      .from('ai_test_sessions')
      .delete()
      .eq(que === 'borrar-prueba' ? 'id' : 'workspace_id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await auditar({});
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'bad_request' }, { status: 400 });
}

async function aplicar(
  db: ReturnType<typeof supabaseAdmin>,
  tabla: 'ai_test_sessions' | 'ai_mejoras_lotes',
  id: string,
  workspaceId: string,
  propuestas: Propuestas | null,
  body: { indice?: unknown; titulo?: unknown; cuando?: unknown; hacer?: unknown },
  auditar: (meta: Record<string, unknown>) => Promise<void>
) {
  const indice = Number(body.indice);
  const propuesta = Number.isSafeInteger(indice) ? propuestas?.reglas?.[indice] : undefined;
  if (!propuestas || !propuesta) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (propuesta.aplicada) return NextResponse.json({ propuestas });
  const r = await aplicarReglaPropuesta(db, workspaceId, propuesta, body);
  if (!r.ok) return NextResponse.json({ error: r.clave }, { status: r.status });
  const nuevas: Propuestas = { ...propuestas, reglas: propuestas.reglas.map((x, i) => (i === indice ? r.propuesta : x)) };
  const { error } = await db.from(tabla).update({ propuestas: nuevas }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await auditar({ workspaceId, indice });
  return NextResponse.json({ propuestas: nuevas });
}
