import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';

/**
 * POST /api/voice/preview  { voice_id, text?, language? }
 * Proxies a short phrase to ElevenLabs TTS so the agent editor can play a
 * voice sample. Returns audio/mpeg bytes. Session-authenticated.
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
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'tts_not_configured' }, { status: 503 });
  }

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

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_flash_v2_5',
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[voice/preview] elevenlabs error', res.status, detail.slice(0, 200));
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
