import { NextResponse } from 'next/server';
import { aplicarReglaPropuesta } from '@/lib/ai/mejoras';
import type { Propuestas } from '@/lib/ai/sesiones-de-prueba';
import { serverError } from '@/lib/api/errors';
import { csrfGuard } from '@/lib/csrf';
import { translate } from '@/lib/i18n/translate';
import { cuentaDeSesion } from '@/lib/workspaces/cuenta-de-sesion';
import { loteVigente } from '@/lib/ai/borrar-mejora';

/**
 * POST /api/ai/feedback/lotes/[id]/aplicar
 *   body: { indice, titulo?, cuando?, hacer? } → { propuestas }
 *
 * Aplica una regla propuesta a partir del feedback real, con lo que haya
 * corregido quien la revisó.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await params;
  const c = await cuentaDeSesion();
  if ('error' in c) return c.error;
  const { admin, workspaceId, locale } = c;
  const body = (await request.json().catch(() => null)) as {
    indice?: unknown;
    titulo?: unknown;
    cuando?: unknown;
    hacer?: unknown;
  } | null;

  const { data: fila, error } = await admin
    .from('ai_mejoras_lotes')
    .select('propuestas')
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .maybeSingle();
  if (error) return serverError(error);
  const propuestas = (fila as { propuestas: Propuestas | null } | null)?.propuestas;
  const indice = Number(body?.indice);
  const propuesta = Number.isSafeInteger(indice) ? propuestas?.reglas?.[indice] : undefined;
  if (!propuestas || !propuesta) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await loteVigente(admin, workspaceId, id))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (propuesta.aplicada) return NextResponse.json({ propuestas });

  const r = await aplicarReglaPropuesta(admin, workspaceId, propuesta, body ?? {});
  if (!r.ok) {
    return NextResponse.json(
      { error: r.clave.includes('.') ? translate(locale, r.clave, r.params) : r.clave },
      { status: r.status }
    );
  }
  const nuevas: Propuestas = {
    ...propuestas,
    reglas: propuestas.reglas.map((x, i) => (i === indice ? r.propuesta : x)),
  };
  const { error: errGuardar } = await admin
    .from('ai_mejoras_lotes')
    .update({ propuestas: nuevas })
    .eq('workspace_id', workspaceId)
    .eq('id', id);
  if (errGuardar) return serverError(errGuardar);
  return NextResponse.json({ propuestas: nuevas });
}
