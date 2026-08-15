import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';

/**
 * PUT /api/admin/workspaces/{id}/suspension  { suspended, reason? }
 *
 * Prende y apaga el acceso de un comercio. Es el interruptor del cobro
 * manual: Riverz se factura por fuera, y sin esto "dar de baja" no tenía
 * ningún efecto sobre el producto.
 *
 * Escribe, a diferencia del resto del panel — que es de solo lectura sobre
 * los datos del comercio. Por eso pasa por las tres barreras: CSRF, ser del
 * equipo, y fila de auditoría con quién lo hizo. El motivo es una nota
 * interna: se guarda para el equipo y nunca se le muestra al comercio.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    suspended?: boolean;
    reason?: string | null;
  } | null;

  if (typeof body?.suspended !== 'boolean') {
    return NextResponse.json({ error: 'suspended required' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const ahora = new Date().toISOString();

  // Al reactivar se limpian las tres columnas: dejar el motivo viejo colgado
  // haría que la próxima suspensión heredara una explicación que no es la
  // suya. Quién la apagó y por qué queda en la auditoría de todas formas.
  const patch = body.suspended
    ? {
        suspended_at: ahora,
        suspended_by: gate.actor.userId,
        suspended_reason: body.reason?.trim() || null,
      }
    : { suspended_at: null, suspended_by: null, suspended_reason: null };

  const { error } = await db.from('workspaces').update(patch).eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void recordAdminAction(gate.actor, request, {
    action: body.suspended ? 'update.workspace_suspend' : 'update.workspace_resume',
    targetType: 'workspace',
    targetId: id,
    meta: body.suspended ? { reason: body.reason?.trim() || null } : {},
  });

  return NextResponse.json({ ok: true, suspended: body.suspended });
}
