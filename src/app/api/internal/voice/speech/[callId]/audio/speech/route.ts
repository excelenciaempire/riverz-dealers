import { supabaseAdmin } from '@/lib/channels/admin-client';
import { assertVoiceWorkerAuth } from '@/lib/voice/auth';
import { getVoiceModelResolved } from '@/lib/voice/model-config';
import { synthesizeBilled } from '@/lib/voice/tts-billing';
export const runtime = 'nodejs';
export async function POST(
  request: Request,
  context: { params: Promise<{ callId: string }> }
) {
  try {
    assertVoiceWorkerAuth(request);
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  const db = supabaseAdmin(),
    { callId } = await context.params;
  const { data: call, error } = await db
    .from('voice_calls')
    .select('workspace_id,ended_at')
    .eq('id', callId)
    .maybeSingle();
  if (error || !call || call.ended_at)
    return new Response(null, { status: 404 });
  const body = await request.json();
  if (
    typeof body.input !== 'string' ||
    !body.input.trim() ||
    body.input.length > 10000
  )
    return new Response(null, { status: 400 });
  const config = await getVoiceModelResolved(db);
  const provider = config.tts_provider;
  const key =
    config.tts_api_key ||
    (provider === 'fish'
      ? process.env.FISH_API_KEY
      : process.env.ELEVENLABS_API_KEY);
  if (!key) return new Response(null, { status: 503 });
  try {
    const response = await synthesizeBilled(
      { db, workspaceId: call.workspace_id, concepto: 'voz_tts' },
      {
        provider,
        key,
        model: config.tts_model,
        voice: String(body.voice ?? config.tts_default_voice_id),
        text: body.input,
        format: 'mp3',
      }
    );
    return new Response(response.body, {
      headers: { 'content-type': 'audio/mpeg' },
    });
  } catch {
    return new Response(null, { status: 402 });
  }
}
