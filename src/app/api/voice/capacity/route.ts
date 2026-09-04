import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { normalizeVoiceCapacity } from '@/lib/voice/capacity';
import type { VoiceConnectionConfig } from '@/types';
import type { AiAgent } from '@/lib/ai/types';
import { normalizeVoiceAgentCapacity } from '@/lib/voice/capacity';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  const agentId = new URL(request.url).searchParams.get('agent_id');
  if (!workspaceId) {
    return NextResponse.json(
      { error: 'workspace_id required' },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { data: member } = await db
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const [
    { data: connection },
    { data: agentRow },
    { data: activeRows },
    { count: queued },
  ] = await Promise.all([
    db
      .from('channel_connections')
      .select('config')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'voice')
      .maybeSingle(),
    agentId
      ? db
          .from('ai_agents')
          .select('*')
          .eq('id', agentId)
          .eq('workspace_id', workspaceId)
          .is('deleted_at', null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from('voice_calls')
      .select('direction, context')
      .eq('workspace_id', workspaceId)
      .match(agentId ? { agent_id: agentId } : {})
      .in('status', ['dialing', 'in_progress'])
      .is('ended_at', null),
    db
      .from('voice_calls')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .match(agentId ? { agent_id: agentId } : {})
      .eq('status', 'queued'),
  ]);

  if (agentId && !agentRow) {
    return NextResponse.json({ error: 'agent_not_found' }, { status: 404 });
  }

  const rawConfig =
    (connection as { config?: VoiceConnectionConfig } | null)?.config ?? {};
  const config = agentRow
    ? normalizeVoiceAgentCapacity(agentRow as AiAgent, rawConfig)
    : normalizeVoiceCapacity(rawConfig);
  const rows = (activeRows ?? []) as {
    direction: 'inbound' | 'outbound';
    context: Record<string, unknown> | null;
  }[];

  return NextResponse.json({
    config: {
      max_concurrent_calls: config.maxConcurrentCalls,
      reserved_inbound_slots: config.reservedInboundSlots,
      max_campaign_concurrent: config.maxCampaignConcurrent,
      dedupe_minutes: config.dedupeMinutes,
    },
    active: rows.length,
    inbound_active: rows.filter((row) => row.direction === 'inbound').length,
    outbound_active: rows.filter((row) => row.direction === 'outbound').length,
    campaign_active: rows.filter(
      (row) => row.direction === 'outbound' && Boolean(row.context?.campaign_id)
    ).length,
    queued: queued ?? 0,
  });
}
