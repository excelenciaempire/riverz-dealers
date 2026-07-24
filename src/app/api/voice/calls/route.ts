import { NextResponse } from 'next/server';
import type { VoiceCallType } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { enqueueCall } from '@/lib/voice/queue';
import { pickVoiceAgent } from '@/lib/voice/inbound';

/**
 * Voice calls — dashboard endpoints.
 *   POST: place a manual "call with AI" from the inbox/contact.
 *   GET:  list recent calls for a workspace (metrics + call log).
 * Session-authenticated; the caller must be a workspace member.
 */

async function requireMember(userId: string, workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
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
    workspace_id?: string;
    contact_id?: string;
    agent_id?: string;
    objective?: string;
    phone?: string;
    call_type?: VoiceCallType;
  } | null;
  if (!body?.workspace_id || !body.contact_id) {
    return NextResponse.json(
      { error: 'workspace_id and contact_id required' },
      { status: 400 },
    );
  }
  if (!(await requireMember(user.id, body.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Resolve the agent: explicit, or the workspace's best voice-enabled agent.
  let agentId = body.agent_id;
  if (!agentId) {
    const agent = await pickVoiceAgent(supabaseAdmin(), body.workspace_id);
    if (!agent) {
      return NextResponse.json({ error: 'no_voice_agent' }, { status: 409 });
    }
    agentId = agent.id;
  }

  try {
    const result = await enqueueCall({
      workspaceId: body.workspace_id,
      agentId,
      contactId: body.contact_id,
      callType: body.call_type ?? 'manual',
      phone: body.phone ?? null,
      immediate: true,
      context: body.objective ? { objective_override: body.objective } : {},
    });
    if (!result.enqueued) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    return NextResponse.json(
      { ok: true, call_id: result.callId, scheduled_at: result.scheduledAt },
      { status: 201 },
    );
  } catch (err) {
    return serverError(err, 'enqueue call failed');
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  }
  if (!(await requireMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const limit = Math.min(200, Number(url.searchParams.get('limit')) || 100);

  const { data, error } = await supabaseAdmin()
    .from('voice_calls')
    .select('*, contact:contacts(id, name, phone)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return serverError(error);
  return NextResponse.json({ calls: data ?? [] });
}
