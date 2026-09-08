import { aiBudgetGuard } from '@/lib/ai/rate-limit';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/server';
import { normalizeStack, resolveVoiceId } from '@/lib/voice/compat';
import { getVoiceModelResolved } from '@/lib/voice/model-config';
import { synthesizeBilled } from '@/lib/voice/tts-billing';
import { isVoiceMember } from '@/lib/voice/voice-connection-store';
import { NextResponse } from 'next/server';

/**
 * POST /api/voice/preview  { voice_id, text?, language? }
 * Synthesizes a short phrase with the SAME TTS the calls use (global admin
 * setting) so the sample the merchant hears is the voice that will actually
 * dial. Falls back to ElevenLabs for providers we can't preview. Returns
 * audio bytes. Session-authenticated.
 */
const SAMPLE = {
  es: 'Hola, te llamo de la tienda para confirmar tu pedido. ¿Tienes un minuto?',
  en: 'Hi, I am calling from the store to confirm your order. Do you have a minute?',
};

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    voice_id?: string;
    text?: string;
    language?: string;
  } | null;
  const workspaceId = body?.workspace_id?.trim();
  const voiceId = body?.voice_id?.trim();
  if (!workspaceId || !voiceId) {
    return NextResponse.json(
      { error: 'workspace_id and voice_id required' },
      { status: 400 }
    );
  }
  if (!(await isVoiceMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const budget = await aiBudgetGuard(workspaceId);
  if (budget) return budget;
  const lang = (body?.language ?? 'es').toLowerCase().startsWith('en')
    ? 'en'
    : 'es';
  const text = (body?.text?.trim() || SAMPLE[lang]).slice(0, 300);

  // La config del stack de voz es de plataforma (RLS: sólo service role).
  const raw = await getVoiceModelResolved(supabaseAdmin()).catch(() => null);
  const model = raw ? normalizeStack(raw).config : null;
  const provider = (model?.tts_provider ?? '').toLowerCase();

  try {
    let res: Response;
    if (provider === 'fish') {
      const apiKey = model?.tts_api_key || process.env.FISH_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: 'tts_not_configured' },
          { status: 503 }
        );
      }
      res = await synthesizeBilled(
        { db: supabaseAdmin(), workspaceId, concepto: 'voz_tts' },
        {
          provider: 'fish',
          key: apiKey,
          model: model?.tts_model || 's2.1-pro',
          // Misma regla que en las llamadas: una voz de otro proveedor no sirve
          // acá → cae a la default de la plataforma, o a la de Fish.
          voice:
            resolveVoiceId(
              'tts',
              'fish',
              voiceId,
              model?.tts_default_voice_id
            ) ?? voiceId,
          text,
        }
      );
    } else {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: 'tts_not_configured' },
          { status: 503 }
        );
      }
      res = await synthesizeBilled(
        { db: supabaseAdmin(), workspaceId, concepto: 'voz_tts' },
        {
          provider: 'elevenlabs',
          key: apiKey,
          model: 'eleven_flash_v2_5',
          voice: voiceId,
          text,
        }
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(
        '[voice/preview] tts error',
        provider,
        res.status,
        detail.slice(0, 200)
      );
      return NextResponse.json({ error: 'tts_failed' }, { status: 502 });
    }
    const audio = await res.arrayBuffer();
    return new NextResponse(audio, {
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[voice/preview] failed', err);
    return NextResponse.json({ error: 'tts_failed' }, { status: 502 });
  }
}
