import { NextResponse } from 'next/server';
import type { VoiceCallType } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';

/**
 * Voice campaigns — bulk outbound calls over a segment.
 *   GET  ?workspace_id=  → list
 *   POST → create (draft or running)
 *   PATCH → change status (start/pause/cancel)
 * Session-authenticated; caller must be a workspace member.
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

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  if (!(await requireMember(user.id, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { data, error } = await supabaseAdmin()
    .from('voice_campaigns')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return serverError(error);
  return NextResponse.json({ campaigns: data ?? [] });
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
    agent_id?: string;
    name?: string;
    segment_id?: string;
    call_type?: VoiceCallType;
    objective?: string;
    start?: boolean;
  } | null;
  if (!body?.workspace_id || !body.agent_id || !body.name?.trim() || !body.segment_id) {
    return NextResponse.json(
      { error: 'workspace_id, agent_id, name and segment_id required' },
      { status: 400 },
    );
  }
  if (!(await requireMember(user.id, body.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin()
    .from('voice_campaigns')
    .insert({
      workspace_id: body.workspace_id,
      agent_id: body.agent_id,
      name: body.name.trim(),
      segment_id: body.segment_id,
      call_type: body.call_type ?? 'manual',
      objective: body.objective?.trim() || null,
      status: body.start ? 'running' : 'draft',
    })
    .select('*')
    .single();
  if (error) return serverError(error);
  return NextResponse.json({ campaign: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    workspace_id?: string;
    status?: 'running' | 'paused' | 'canceled';
  } | null;
  if (!body?.id || !body.workspace_id || !body.status) {
    return NextResponse.json({ error: 'id, workspace_id and status required' }, { status: 400 });
  }
  if (!(await requireMember(user.id, body.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { error } = await supabaseAdmin()
    .from('voice_campaigns')
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .eq('workspace_id', body.workspace_id);
  if (error) return serverError(error);
  return NextResponse.json({ ok: true });
}
