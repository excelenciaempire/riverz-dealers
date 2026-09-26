import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api/errors';
import { csrfGuard } from '@/lib/csrf';
import { cuentaDeSesion } from '@/lib/workspaces/cuenta-de-sesion';

/**
 * PATCH /api/ai/feedback/ajustes { automaticas } → { automaticas }
 *
 * "Aplicar mejoras solas": las reglas que la IA propone a partir del feedback
 * se aplican sin esperar un clic. Cada una queda marcada como automática y
 * guarda cómo estaba antes, para revisarla o volver atrás.
 */
export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuentaDeSesion();
  if ('error' in c) return c.error;
  const body = (await request.json().catch(() => null)) as { automaticas?: unknown } | null;
  if (typeof body?.automaticas !== 'boolean') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const { error } = await c.admin
    .from('workspaces')
    .update({ mejoras_automaticas: body.automaticas })
    .eq('id', c.workspaceId);
  if (error) return serverError(error);
  return NextResponse.json({ automaticas: body.automaticas });
}
