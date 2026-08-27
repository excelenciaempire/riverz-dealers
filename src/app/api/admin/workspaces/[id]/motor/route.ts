import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { ponerMotor } from '@/lib/workspaces/motor';

/**
 * PUT /api/admin/workspaces/{id}/motor  { encendido }
 *
 * El interruptor del motor de una cuenta: con él apagado no sale ni un mensaje
 * —ni respuesta del agente, ni automatización, ni difusión, ni llamada— y el
 * comercio SIGUE entrando a su panel.
 *
 * Es la diferencia con `suspension`, que está al lado y hace las dos cosas a la
 * vez porque nació para dar de baja a quien no paga. Acá el comercio tiene que
 * poder entrar: es el estado en el que mira la operación recién montada y la
 * aprueba, y suspenderlo lo dejaría afuera de esa pantalla.
 *
 * Escribe, así que pasa por las tres barreras del panel: CSRF, ser del equipo,
 * y fila de auditoría con quién lo hizo.
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
    encendido?: boolean;
  } | null;

  if (typeof body?.encendido !== 'boolean') {
    return NextResponse.json({ error: 'encendido required' }, { status: 400 });
  }

  try {
    await ponerMotor(supabaseAdmin(), id, body.encendido, gate.actor.userId);
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'falló';
    return NextResponse.json({ error: motivo }, { status: 500 });
  }

  void recordAdminAction(gate.actor, request, {
    action: body.encendido ? 'update.workspace_motor_on' : 'update.workspace_motor_off',
    targetType: 'workspace',
    targetId: id,
    meta: {},
  });

  return NextResponse.json({ ok: true, encendido: body.encendido });
}
