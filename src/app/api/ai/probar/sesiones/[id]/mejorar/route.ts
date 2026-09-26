import { NextResponse } from 'next/server';
import { cuentaDeLaPrueba } from '@/lib/ai/cuenta-de-prueba';
import { mejorarSesionDePrueba } from '@/lib/ai/mejoras-de-pruebas';
import { aiTestGuard } from '@/lib/ai/rate-limit';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { probandoSinPagar } from '@/lib/wallet/prueba';

/**
 * POST /api/ai/probar/sesiones/[id]/mejorar → { propuestas }
 *
 * Convierte lo que se marcó en una prueba en cambios concretos: reglas para
 * crear o editar, que se revisan y se aplican con un clic (o solas, si el
 * comercio lo activó), y lo que no se arregla con una regla, a la cola del
 * equipo de Riverz. Ver `lib/ai/mejoras`.
 */
export function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return probandoSinPagar(() => mejorar(request, ctx));
}

async function mejorar(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const overBudget = await aiTestGuard(workspaceId);
  if (overBudget) return overBudget;
  try {
    const r = await mejorarSesionDePrueba(admin, workspaceId, id);
    if (r === 'no_existe') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (r === 'sin_feedback') {
      return NextResponse.json({ error: translate(locale, 'assistant.pruebasSinFeedback') }, { status: 400 });
    }
    if (r === 'fallo') {
      return NextResponse.json({ error: translate(locale, 'errAi.testGenerateFailed') }, { status: 502 });
    }
    return NextResponse.json({ propuestas: r });
  } catch (err) {
    return serverError(err, translate(locale, 'errAi.testGenerateFailed'), 502);
  }
}
