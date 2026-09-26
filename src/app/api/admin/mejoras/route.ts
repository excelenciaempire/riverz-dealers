import { NextResponse } from 'next/server';
import { recordAdminAction } from '@/lib/admin/audit';
import { requireAdmin } from '@/lib/admin/guard';
import { adminGet } from '@/lib/admin/route';
import { taparDatos } from '@/lib/ai/mejoras';
import type { ItemGuardado } from '@/lib/ai/sesiones-de-prueba';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

/**
 * Pruebas y feedback de los comercios, para el panel de plataforma.
 *
 * GET   /api/admin/mejoras                 → { comercios } con sus cuentas
 * GET   /api/admin/mejoras?workspace=<id>  → { pruebas, feedback, plataforma }
 * PATCH /api/admin/mejoras { id, estado }  → cambia el estado de un pedido a
 *       la plataforma (pendiente, en_curso, resuelta, descartada).
 *
 * Las pruebas son conversaciones de mentira: se muestran enteras. El feedback
 * real trae el tramo que el comercio compartió al marcarlo, con los teléfonos y
 * correos tapados: son datos de SUS clientes.
 */
export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get('workspace');
  return adminGet(
    request,
    { action: 'view.mejoras', meta: { workspaceId } },
    async () => {
      const db = supabaseAdmin();
      if (!workspaceId) {
        const [{ data: pruebas }, { data: feedback }, { data: plataforma }] = await Promise.all([
          db.from('ai_test_sessions').select('workspace_id, feedback').limit(5000),
          db.from('ai_feedback').select('workspace_id').limit(5000),
          db.from('mejoras_plataforma').select('workspace_id, estado').limit(5000),
        ]);
        const cuentas = new Map<string, { pruebas: number; feedbackPruebas: number; feedbackReal: number; plataforma: number }>();
        const de = (id: string) => {
          if (!cuentas.has(id)) cuentas.set(id, { pruebas: 0, feedbackPruebas: 0, feedbackReal: 0, plataforma: 0 });
          return cuentas.get(id)!;
        };
        for (const p of (pruebas ?? []) as Array<{ workspace_id: string; feedback: unknown }>) {
          const c = de(p.workspace_id);
          c.pruebas++;
          c.feedbackPruebas += Array.isArray(p.feedback) ? p.feedback.length : 0;
        }
        for (const f of (feedback ?? []) as Array<{ workspace_id: string }>) de(f.workspace_id).feedbackReal++;
        for (const m of (plataforma ?? []) as Array<{ workspace_id: string; estado: string }>) {
          if (m.estado === 'pendiente' || m.estado === 'en_curso') de(m.workspace_id).plataforma++;
        }
        const ids = [...cuentas.keys()];
        const { data: nombres } = ids.length
          ? await db.from('workspaces').select('id, name').in('id', ids)
          : { data: [] };
        const nombre = new Map(((nombres ?? []) as Array<{ id: string; name: string | null }>).map((w) => [w.id, w.name]));
        return {
          comercios: ids
            .map((id) => ({ id, nombre: nombre.get(id) ?? id.slice(0, 8), ...cuentas.get(id)! }))
            .sort((a, b) => b.pruebas + b.feedbackReal - (a.pruebas + a.feedbackReal)),
        };
      }

      const [{ data: pruebas }, { data: feedback }, { data: plataforma }, { data: ws }, { data: cambios }, { data: lotes }, { data: agentes }] = await Promise.all([
        db
          .from('ai_test_sessions')
          .select('id, origen, escenario, canal, detalle, items, feedback, propuestas, mensajes, enviada_at, created_at, updated_at')
          .eq('workspace_id', workspaceId)
          .order('enviada_at', { ascending: false, nullsFirst: false })
          .order('updated_at', { ascending: false })
          .limit(100),
        db
          .from('ai_feedback')
          .select('id, canal, voto, nota, captura, estado, created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(100),
        db
          .from('mejoras_plataforma')
          .select('id, origen, origen_id, problema, prompt, estado, nota, created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(100),
        db.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
        db
          .from('cambios_de_plantilla')
          .select('id, plantilla_nombre, antes, despues, estado, nueva_plantilla, motivo, created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(100),
        db
          .from('ai_mejoras_lotes')
          .select('id, propuestas, created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(5),
        db.from('ai_agents').select('id, name').eq('workspace_id', workspaceId).is('deleted_at', null),
      ]);
      return {
        comercio: (ws as { name?: string | null } | null)?.name ?? null,
        pruebas: pruebas ?? [],
        feedback: ((feedback ?? []) as Array<{ captura: ItemGuardado[]; nota: string }>).map((f) => ({
          ...f,
          nota: f.nota,
          captura: (Array.isArray(f.captura) ? f.captura : []).map((it) =>
            'texto' in it ? { ...it, texto: taparDatos(it.texto) } : it
          ),
        })),
        plataforma: plataforma ?? [],
        cambios: cambios ?? [],
        lotes: lotes ?? [],
        agentes: agentes ?? [],
      };
    }
  );
}

const ESTADOS = new Set(['pendiente', 'en_curso', 'resuelta', 'descartada']);

export async function PATCH(request: Request) {
  const csrf = await csrfGuard(request);
  if (csrf) return csrf;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.res;
  const body = (await request.json().catch(() => null)) as { id?: unknown; estado?: unknown } | null;
  if (typeof body?.id !== 'string' || typeof body.estado !== 'string' || !ESTADOS.has(body.estado)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const { error } = await supabaseAdmin()
    .from('mejoras_plataforma')
    .update({ estado: body.estado, updated_at: new Date().toISOString() })
    .eq('id', body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recordAdminAction(auth.actor, request, {
    action: 'update.mejora_plataforma',
    targetType: 'mejoras_plataforma',
    targetId: body.id,
    meta: { estado: body.estado },
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
