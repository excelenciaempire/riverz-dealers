import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import {
  getVoiceModelConfig,
  buildModelUpdate,
  type VoiceModelConfig,
} from '@/lib/voice/model-config';

/**
 * Global voice model stack — PLATFORM ADMIN ONLY.
 * GET  → current config.
 * PUT  → update (STT/LLM/TTS models, mode, realtime engine). Applies to every
 *        workspace; merchants can't reach this.
 */
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const config = await getVoiceModelConfig(supabaseAdmin());
  return NextResponse.json({ config });
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as
    | (Partial<VoiceModelConfig> & {
        stt_api_key?: string;
        llm_api_key?: string;
        tts_api_key?: string;
        realtime_api_key?: string;
      })
    | null;
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  if (body.mode && !['pipeline', 'realtime'].includes(body.mode)) {
    return NextResponse.json({ error: 'invalid_mode' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  // El estado ACTUAL es lo que permite detectar un cambio de proveedor y barrer
  // el endpoint/key del anterior antes de que rompan la próxima llamada.
  const current = await getVoiceModelConfig(admin);
  const { update, changes } = buildModelUpdate(body, current);
  update.updated_at = new Date().toISOString();
  update.updated_by = gate.actor.userId;

  try {
    // `upsert` y no `update`: la tabla es de una sola fila sembrada por la
    // migración 114. Si esa fila faltara, un `update` no afecta nada y devuelve
    // éxito — la UI mostraría "Guardado" sin haber guardado. Además ahora se
    // comprueba el error de Supabase, que antes se descartaba.
    const { error } = await admin
      .from('voice_model_config')
      .upsert({ id: 1, ...update }, { onConflict: 'id' });
    if (error) return serverError(error, 'save voice model config failed');

    const config = await getVoiceModelConfig(admin);
    await recordAdminAction(gate.actor, request, {
      action: 'update.voice_model',
      targetType: 'voice_model',
      meta: { mode: body.mode ?? null, auto_fixed: changes.length || null },
    });
    // `changes` = lo que se ajustó solo para que el stack quede coherente. La UI
    // lo muestra: un cambio silencioso en la config de voz es peor que ninguno.
    return NextResponse.json({ ok: true, config, changes });
  } catch (err) {
    return serverError(err, 'save voice model config failed');
  }
}
