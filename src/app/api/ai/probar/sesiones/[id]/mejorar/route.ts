import { NextResponse } from 'next/server';
import { cuentaDeLaPrueba } from '@/lib/ai/cuenta-de-prueba';
import { completeTextMedido } from '@/lib/ai/medido';
import { aiTestGuard } from '@/lib/ai/rate-limit';
import {
  leerPropuestas,
  limpiarFeedback,
  limpiarItems,
  pedidoDeMejoras,
  SISTEMA_MEJORAS,
  transcripcionConFeedback,
  type ReglaParaMejorar,
} from '@/lib/ai/sesiones-de-prueba';
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
 * crear o editar, que se revisan y se aplican con un clic, y lo que no se
 * arregla con una regla, como un prompt para quien lo tenga que cambiar.
 * Nada se aplica solo: una nota mal entendida no puede cambiarle el discurso
 * al asistente sin que alguien la lea.
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
  const { data: fila, error } = await admin
    .from('ai_test_sessions')
    .select('items, feedback')
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .maybeSingle();
  if (error) return serverError(error);
  if (!fila) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const items = limpiarItems((fila as { items: unknown }).items);
  const feedback = limpiarFeedback((fila as { feedback: unknown }).feedback, items.length);
  if (feedback.length === 0) {
    return NextResponse.json({ error: translate(locale, 'assistant.pruebasSinFeedback') }, { status: 400 });
  }

  const overBudget = await aiTestGuard(workspaceId);
  if (overBudget) return overBudget;

  const [{ data: agentes }, { data: reglas }] = await Promise.all([
    admin.from('ai_agents').select('id, name').eq('workspace_id', workspaceId).is('deleted_at', null),
    admin
      .from('agent_guidance')
      .select('id, agent_id, titulo, cuando, hacer')
      .eq('workspace_id', workspaceId)
      .eq('activa', true)
      .order('orden', { ascending: true }),
  ]);
  const listaAgentes = (agentes ?? []) as Array<{ id: string; name: string }>;
  const listaReglas = (reglas ?? []) as ReglaParaMejorar[];

  let salida: string | null;
  try {
    salida = await completeTextMedido(admin, {
      workspaceId,
      concepto: 'ia_asistencia',
      referenciaTipo: 'ai_test_session',
      referenciaId: id,
      tier: 'premium',
      effort: 'medium',
      maxTokens: 4000,
      system: SISTEMA_MEJORAS,
      user: pedidoDeMejoras(listaAgentes, listaReglas, transcripcionConFeedback(items, feedback)),
    });
  } catch (err) {
    return serverError(err, translate(locale, 'errAi.testGenerateFailed'), 502);
  }
  if (salida === null) {
    return NextResponse.json({ error: translate(locale, 'errAi.testGenerateFailed') }, { status: 502 });
  }
  const propuestas = {
    ...leerPropuestas(salida, {
      reglas: new Set(listaReglas.map((r) => r.id)),
      agentes: new Set(listaAgentes.map((a) => a.id)),
    }),
    generadas_at: new Date().toISOString(),
  };
  const { error: errGuardar } = await admin
    .from('ai_test_sessions')
    .update({ propuestas })
    .eq('workspace_id', workspaceId)
    .eq('id', id);
  if (errGuardar) return serverError(errGuardar);
  return NextResponse.json({ propuestas });
}
