import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { getVoiceModelResolved } from '@/lib/voice/model-config';
import { normalizeStack, resolveVoiceId } from '@/lib/voice/compat';

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

/** Fish Audio TTS (S2.1). `reference_id` es el voice_id; devuelve mp3. */
async function fishTts(opts: {
  apiKey: string;
  model: string;
  voiceId: string | null;
  text: string;
}): Promise<Response> {
  return fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      'content-type': 'application/json',
      // El modelo va en un HEADER, no en el body (contrato de Fish).
      model: opts.model,
    },
    body: JSON.stringify({
      text: opts.text,
      format: 'mp3',
      ...(opts.voiceId ? { reference_id: opts.voiceId } : {}),
    }),
  });
}

async function elevenLabsTts(opts: {
  apiKey: string;
  model: string;
  voiceId: string;
  text: string;
}): Promise<Response> {
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': opts.apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text: opts.text, model_id: opts.model }),
    },
  );
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    voice_id?: string;
    text?: string;
    language?: string;
  } | null;
  const voiceId = body?.voice_id?.trim();
  if (!voiceId) {
    return NextResponse.json({ error: 'voice_id required' }, { status: 400 });
  }
  const lang = (body?.language ?? 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
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
        return NextResponse.json({ error: 'tts_not_configured' }, { status: 503 });
      }
      res = await fishTts({
        apiKey,
        model: model?.tts_model || 's2.1-pro',
        // Misma regla que en las llamadas: una voz de otro proveedor no sirve
        // acá → cae a la default de la plataforma, o a la de Fish.
        voiceId: resolveVoiceId('tts', 'fish', voiceId, model?.tts_default_voice_id),
        text,
      });
    } else {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: 'tts_not_configured' }, { status: 503 });
      }
      res = await elevenLabsTts({
        apiKey,
        model: 'eleven_flash_v2_5',
        voiceId,
        text,
      });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[voice/preview] tts error', provider, res.status, detail.slice(0, 200));
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
