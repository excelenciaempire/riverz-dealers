import { NextResponse } from 'next/server';
import type { VoiceCall } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { serverError } from '@/lib/api/errors';
import {resolveWorkspaceIdForUser} from '@/lib/workspaces/resolve';
import {isVoiceMailboxCall,readVoiceMailboxAudio,VoiceMailboxAudioError} from '@/lib/voice/mailbox-audio';
import {getLocale} from '@/lib/i18n/server';
import {translate} from '@/lib/i18n/translate';

/**
 * GET /api/voice/calls/[id]
 * Full detail for a single call: the row (+ contact) and the materialized
 * transcript turns (from the call's `voice` conversation messages).
 * Session-authenticated; the caller must be a member of the call's workspace.
 */

interface TranscriptTurn {
  role: 'agent' | 'customer';
  text: string;
  ts: string;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { data: callRow, error } = await supabaseAdmin()
      .from('voice_calls')
      .select('*, contact:contacts(id, name, phone), agent:ai_agents(id, name), automation:automations(id, name)')
      .eq('id', id)
      .maybeSingle();
    if (error) return serverError(error);
    if (!callRow) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const call = callRow as VoiceCall;

    const mailbox=isVoiceMailboxCall(call);
    if(mailbox) {
      call.recording_url=await readVoiceMailboxAudio(supabaseAdmin(),call,user.id,await resolveWorkspaceIdForUser(supabase,user.id));
    }
    // The new mailbox requires current section, contact and conversation
    // authority above. Preserve the existing gate for ordinary calls.
    if(!mailbox) {
    const { data: member } = await supabaseAdmin()
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', call.workspace_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // Reproducción de la grabación: el egress sube a un bucket PRIVADO
    // "voice-recordings" como `<call_id>.ogg`. Firmamos una URL de corta vida
    // para que el navegador pueda reproducirla (el recording_url guardado es una
    // ruta S3, no reproducible directo).
    //
    // Se intenta SIEMPRE, no sólo cuando la fila tiene `recording_url`. El
    // egress sube el archivo por su cuenta, directo de LiveKit a Storage: si el
    // worker muere antes de reportar —lo vimos hoy, un deploy ajeno le reemplazó
    // el contenedor a mitad de llamada— el audio queda ahí y la fila sin URL, o
    // sea una grabación que existe y nadie puede escuchar. La clave es
    // determinista, así que preguntarle a Storage es la fuente de verdad.
    // Fail-soft: si no hay objeto, `createSignedUrl` devuelve error y se deja
    // como estaba.
    if(!mailbox) {
      const { data: signed } = await supabaseAdmin()
        .storage.from('voice-recordings')
        .createSignedUrl(`${call.id}.ogg`, 60 * 60);
      if (signed?.signedUrl) call.recording_url = signed.signedUrl;
    }

    let transcript: TranscriptTurn[] = [];
    if (call.conversation_id) {
      const { data: msgs } = await supabaseAdmin()
        .from('messages')
        .select('sender_type, content_text, created_at')
        .eq('conversation_id', call.conversation_id)
        .order('created_at', { ascending: true })
        .limit(500);
      transcript = (msgs ?? [])
        .map((m: { sender_type: string | null; content_text: string | null; created_at: string }) => ({
          role: (m.sender_type === 'customer' ? 'customer' : 'agent') as 'agent' | 'customer',
          text: m.content_text ?? '',
          ts: m.created_at,
        }))
        .filter((t) => t.text.trim().length > 0);
    }

    return NextResponse.json({ call, transcript },{headers:{'Cache-Control':'private, no-store'}});
  } catch (err) {
    if(err instanceof VoiceMailboxAudioError) {
      const locale=await getLocale();
      return NextResponse.json({error:translate(locale,err.code==='notFound'?'errAi.notFound':'voice.fallbackUnavailable')},{status:err.code==='notFound'?404:503,headers:{'Cache-Control':'private, no-store'}});
    }
    return serverError(err, 'voice call detail failed');
  }
}
