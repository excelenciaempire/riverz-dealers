import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { createClient } from '@/lib/supabase/server';
import { CURATED_VOICES_BY_PROVIDER } from '@/lib/voice/constants';
import { getVoiceModelResolved } from '@/lib/voice/model-config';
import { isVoiceMember } from '@/lib/voice/voice-connection-store';

/**
 * Las voces entre las que el comercio puede elegir DE VERDAD.
 *
 * El proveedor de TTS lo fija la plataforma en `/admin/voz` y el comercio no lo
 * ve. El editor, mientras tanto, ofrecía siempre las cuatro voces de
 * ElevenLabs: se guardaban, `resolveVoiceId` las descartaba por no tener la
 * forma del proveedor activo, y la llamada salía con la voz por defecto. Las
 * cuatro sonaban igual porque el botón de escuchar sintetiza con el proveedor
 * real.
 *
 * Devuelve las del proveedor activo, o una lista vacía cuando no tenemos
 * curaduría para él — ahí el editor no dibuja el selector en vez de inventar
 * una elección que no se respeta.
 *
 * No expone llaves ni el modelo: sólo el nombre del proveedor y las voces.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  }
  if (!(await isVoiceMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const model = await getVoiceModelResolved(supabaseAdmin());
  // En realtime la voz la nombra el motor S2S, no el catálogo de TTS.
  const provider =
    model.mode === 'realtime' ? model.realtime_provider : model.tts_provider;
  return NextResponse.json({
    provider,
    voices: CURATED_VOICES_BY_PROVIDER[provider ?? ''] ?? [],
  });
}
