import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { normalizeVoiceCapacity } from '@/lib/voice/capacity';
import type { VoiceConnectionConfig } from '@/types';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
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

  const [{ data: connection }, { data: activeRows }, { count: queued }] =
    await Promise.all([
      db
        .from('channel_connections')
        .select('config')
        .eq('workspace_id', workspaceId)
        .eq('channel', 'voice')
        .maybeSingle(),
      db
        .from('voice_calls')
        .select('direction, context')
        .eq('workspace_id', workspaceId)
        .in('status', ['dialing', 'in_progress'])
        .is('ended_at', null),
      db
        .from('voice_calls')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'queued'),
    ]);

  const rawConfig =
    (connection as { config?: VoiceConnectionConfig } | null)?.config ?? {};
  const config = normalizeVoiceCapacity(rawConfig);
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
