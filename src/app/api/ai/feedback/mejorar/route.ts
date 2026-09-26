import { NextResponse } from 'next/server';
import { mejorarFeedbackReal } from '@/lib/ai/mejoras-de-pruebas';
import { aiBudgetGuard } from '@/lib/ai/rate-limit';
import { serverError } from '@/lib/api/errors';
import { csrfGuard } from '@/lib/csrf';
import { translate } from '@/lib/i18n/translate';
import { cuentaDeSesion } from '@/lib/workspaces/cuenta-de-sesion';

/**
 * POST /api/ai/feedback/mejorar → { lote } | { sin_feedback: true }
 *
 * Convierte el feedback nuevo de la bandeja en reglas propuestas (y, si el
 * comercio lo activó, las aplica solas). Lo que no se arregla con una regla
 * va a la cola del equipo de Riverz.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuentaDeSesion();
  if ('error' in c) return c.error;
  const { admin, workspaceId, locale } = c;
  const over = await aiBudgetGuard(workspaceId);
  if (over) return over;
  try {
    const r = await mejorarFeedbackReal(admin, workspaceId, { automatico: false });
    if (r === 'sin_feedback') return NextResponse.json({ sin_feedback: true });
    if (r === 'fallo') {
      return NextResponse.json({ error: translate(locale, 'errAi.testGenerateFailed') }, { status: 502 });
    }
    return NextResponse.json({ lote: r });
  } catch (err) {
    return serverError(err, translate(locale, 'errAi.testGenerateFailed'), 502);
  }
}
