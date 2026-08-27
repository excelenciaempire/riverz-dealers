import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { aiBudgetGuard } from '@/lib/ai/rate-limit';
import { serverError } from '@/lib/api/errors';
import { getAnthropic } from '@/lib/ai/anthropic-client';
import { DEFAULT_OBJECTIVES } from '@/lib/voice/constants';

/**
 * AI-assisted voice setup: the merchant describes, in plain language, when
 * they want the agent to call; Claude turns it into a voice config the Voz
 * tab can apply (enabled call types + objectives + greeting + "AI decides").
 * Setup should feel like a sentence, not a form. Session-authed.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    description?: string;
    language?: string;
  } | null;
  if (!body?.workspace_id || !body.description?.trim()) {
    return NextResponse.json(
      { error: 'workspace_id and description required' },
      { status: 400 },
    );
  }

  const { data: member } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', body.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const overBudget = await aiBudgetGuard(body.workspace_id);
  if (overBudget) return overBudget;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ai_not_configured' }, { status: 503 });

  const lang = (body.language ?? 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  // Ojo: NO se le pide que "active" tipos de llamada. `objectives[tipo].enabled`
  // no lo lee nadie desde que el nodo del lienzo quedó como única vía
  // automática — quién llama y cuándo lo deciden las reglas, no el agente. Lo
  // que sí hace falta de acá es el GUION de cada tipo, que es lo que
  // `buildVoiceContext` lee cuando la llamada ya existe. Pedirle que
  // "active" producía un JSON que el comercio veía aplicado y que no cambiaba
  // ningún comportamiento.
  const system = `Eres un asistente que configura un AGENTE DE VOZ telefónico para una tienda. A partir de la descripción del comerciante escribes el OBJETIVO de cada tipo de llamada —qué tiene que lograr el agente cuando esa llamada ocurre—, un saludo inicial breve y natural, y decides si conviene dejar que la IA decida llamar sola.
Tipos de llamada: order_confirmation (confirmar pedido), cart_recovery (recuperar carrito), followup (seguimiento si el cliente dejó de responder), inbound (contestar llamadas entrantes).
Devuelve SOLO un JSON válido con esta forma exacta, sin texto extra:
{"voice_enabled":true,"voice_ai_decides":false,"voice_greeting":"...","objectives":{"order_confirmation":{"objective":""},"cart_recovery":{"objective":""},"followup":{"objective":""},"inbound":{"objective":""}}}
Reglas: escribe los CUATRO objetivos, cortos y accionables, adaptados al negocio que describe el comerciante; el saludo usa {{contact_name}} para el nombre; escribe todo en '${lang}'. Si el comerciante menciona que la IA decida u opere sola, pon voice_ai_decides=true.`;

  try {
    const client = getAnthropic(apiKey);
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system,
      messages: [{ role: 'user', content: body.description.trim().slice(0, 2000) }],
    });
    const text = resp.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    // Defensive parse — strip any code fences the model might add.
    const jsonStr = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({ error: 'parse_failed' }, { status: 502 });
    }

    // Normalize into our shape with safe fallbacks.
    const objIn = (parsed.objectives ?? {}) as Record<string, { objective?: string }>;
    const objectives: Record<string, { enabled: boolean; objective: string }> = {};
    for (const key of ['order_confirmation', 'cart_recovery', 'followup', 'inbound'] as const) {
      const o = objIn[key] ?? {};
      objectives[key] = {
        // Se sigue escribiendo en true por compatibilidad con las filas que ya
        // están en la base; nadie lo lee. El guion es lo único que decide.
        enabled: true,
        objective: (o.objective && String(o.objective).trim()) || DEFAULT_OBJECTIVES[key][lang],
      };
    }
    return NextResponse.json({
      config: {
        voice_enabled: parsed.voice_enabled !== false,
        voice_ai_decides: Boolean(parsed.voice_ai_decides),
        voice_greeting: typeof parsed.voice_greeting === 'string' ? parsed.voice_greeting : '',
        objectives,
      },
    });
  } catch (err) {
    return serverError(err, 'voice setup failed');
  }
}
