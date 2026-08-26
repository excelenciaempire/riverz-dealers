import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { getVoiceModelResolved } from '@/lib/voice/model-config';
import { probarCapa, type VoiceLayer } from '@/lib/voice/probe';

const CAPAS: VoiceLayer[] = ['stt', 'llm', 'tts', 'realtime'];

/**
 * Probar el stack de voz — SOLO ADMIN DE PLATAFORMA.
 *
 * POST { layer? } → prueba esa capa, o las tres del pipeline si no se dice
 * cuál. Le pregunta a cada proveedor con la llave que USARÍA el worker.
 *
 * Es POST y no GET porque sale a la red hacia terceros; y pasa por el guard de
 * admin porque las respuestas traen detalle del proveedor.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as { layer?: string } | null;
  const pedida = body?.layer;
  if (pedida && !CAPAS.includes(pedida as VoiceLayer)) {
    return NextResponse.json({ error: 'invalid_layer' }, { status: 400 });
  }

  try {
    const cfg = await getVoiceModelResolved(supabaseAdmin());
    // Sin capa pedida se prueba lo que el modo usa de verdad: en realtime hay
    // un solo motor; en pipeline, las tres capas.
    const capas: VoiceLayer[] = pedida
      ? [pedida as VoiceLayer]
      : cfg.mode === 'realtime'
        ? ['realtime']
        : ['stt', 'llm', 'tts'];

    const resultados: Record<string, unknown> = {};
    await Promise.all(
      capas.map(async (c) => {
        resultados[c] = await probarCapa(cfg, c);
      }),
    );

    await recordAdminAction(gate.actor, request, {
      action: 'test.voice_model',
      targetType: 'voice_model',
      meta: { layers: capas },
    });

    return NextResponse.json({ ok: true, results: resultados });
  } catch (err) {
    return serverError(err, 'voice model test failed');
  }
}
