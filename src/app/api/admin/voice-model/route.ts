import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import {
  getVoiceModelConfig,
  type VoiceModelConfig,
} from '@/lib/voice/model-config';

/**
 * Global voice model stack — PLATFORM ADMIN ONLY.
 * GET  → current config.
 * PUT  → update (STT/LLM/TTS models, mode, realtime engine). Applies to every
 *        workspace; merchants can't reach this.
 */
async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; res: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  if (!isPlatformAdmin(user.email)) {
    return { ok: false, res: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId: user.id };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const config = await getVoiceModelConfig(supabaseAdmin());
  return NextResponse.json({ config });
}

const ALLOWED: (keyof VoiceModelConfig)[] = [
  'mode',
  'stt_provider',
  'stt_model',
  'stt_language',
  'llm_provider',
  'llm_model',
  'tts_provider',
  'tts_model',
  'tts_default_voice_id',
  'realtime_provider',
  'realtime_model',
];

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as Partial<VoiceModelConfig> | null;
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  if (body.mode && !['pipeline', 'realtime'].includes(body.mode)) {
    return NextResponse.json({ error: 'invalid_mode' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const k of ALLOWED) {
    if (k in body) update[k] = body[k];
  }
  update.updated_at = new Date().toISOString();
  update.updated_by = gate.userId;

  try {
    const admin = supabaseAdmin();
    await admin.from('voice_model_config').update(update).eq('id', 1);
    const config = await getVoiceModelConfig(admin);
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return serverError(err, 'save voice model config failed');
  }
}
