import { aiTestGuard } from '@/lib/ai/rate-limit';
import {
  canalSimulado,
  normalizarHistorial,
  simularRespuesta,
  SinClaveError,
} from '@/lib/ai/simulacion';
import type { AiAgent } from '@/lib/ai/types';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * Probar UN agente sin tocar ningún canal.
 *
 * Esto tenía que ser una vista previa de producción y era otra cosa: armaba el
 * prompt a mano —sin el material de los productos, sin el research, sin las
 * reglas por producto, sin el rol, sin la política de ofertas—, exponía tres
 * herramientas de dieciséis sin mirar la pizarra del comercio, y era SIN
 * ESTADO: cada mensaje era el primero, así que no se podía probar una
 * confirmación, un escalamiento por cantidad de respuestas, ni nada que
 * necesitara dos turnos. El comercio probaba un agente y publicaba otro.
 *
 * El cuerpo vive en `lib/ai/simulacion` (lo comparte con "Probar como
 * cliente", que además elige el agente como producción). Acá queda lo que es
 * de una ruta: sesión, permiso y traducción del error.
 *
 * POST /api/ai/agents/[id]/test
 *   body: { message: string, historial?: {role,content}[], simulated_phone?: string,
 *           simulated_channel?: Channel }
 *   → { reply, chunks, herramientas, usage }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errAi.unauthorized') },
      { status: 401 }
    );

  const body = (await request.json().catch(() => null)) as {
    message?: string;
    simulated_phone?: string;
    simulated_channel?: unknown;
    historial?: unknown;
  } | null;
  const message = body?.message?.trim();
  if (!message) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.messageRequired') },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();
  const { data: agent } = await admin
    .from('ai_agents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!agent)
    return NextResponse.json(
      { error: translate(locale, 'errAi.notFound') },
      { status: 404 }
    );

  const { data: member } = await admin
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', (agent as AiAgent).workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member)
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 }
    );

  const overBudget = await aiTestGuard((agent as AiAgent).workspace_id);
  if (overBudget) return overBudget;

  try {
    const result = await simularRespuesta(admin, agent as AiAgent, {
      message,
      historial: normalizarHistorial(body?.historial),
      simulatedPhone: body?.simulated_phone,
      simulatedChannel: canalSimulado(body?.simulated_channel),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SinClaveError) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.missingApiKey') },
        { status: 500 }
      );
    }
    return serverError(err, translate(locale, 'errAi.testGenerateFailed'), 502);
  }
}
