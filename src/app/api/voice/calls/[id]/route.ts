import { NextResponse } from 'next/server';
import type { VoiceCall } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { serverError } from '@/lib/api/errors';

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
      .select('*, contact:contacts(id, name, phone)')
      .eq('id', id)
      .maybeSingle();
    if (error) return serverError(error);
    if (!callRow) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const call = callRow as VoiceCall;

    // Membership gate on the call's workspace.
    const { data: member } = await supabaseAdmin()
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', call.workspace_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

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

    return NextResponse.json({ call, transcript });
  } catch (err) {
    return serverError(err, 'voice call detail failed');
  }
}
