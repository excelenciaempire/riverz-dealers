import { NextResponse } from 'next/server';
import type { VoiceCall } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { serverError } from '@/lib/api/errors';
import {
  summarizeVoiceCalls,
  VOICE_STATS_COLUMNS,
} from '@/lib/voice/analytics';
import { workspaceTimezone } from '@/lib/workspaces/timezone';

/**
 * GET /api/voice/analytics?workspace_id=&days=30
 *   (or &start=ISO&end=ISO to follow the dashboard date-range filter)
 * Aggregates voice_calls for the range: answer rate, confirmation rate,
 * minutes, estimated cost, upsell revenue, and breakdowns by hour / city /
 * outcome. Session-authenticated (workspace member).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId)
    return NextResponse.json(
      { error: 'workspace_id required' },
      { status: 400 }
    );

  const { data: member } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Range: explicit start/end (dashboard filter) wins; else last N days.
  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  const agentId = url.searchParams.get('agent_id');
  const days = Math.min(
    365,
    Math.max(1, Number(url.searchParams.get('days')) || 30)
  );
  const since =
    startParam || new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    let query = supabaseAdmin()
      .from('voice_calls')
      .select(VOICE_STATS_COLUMNS)
      .eq('workspace_id', workspaceId)
      .gte('created_at', since)
      .limit(10000);
    // El panel general mide la operación saliente. Dentro de un agente se
    // muestran todas sus llamadas, incluidas las entrantes que atendió.
    query = agentId
      ? query.eq('agent_id', agentId)
      : query.eq('direction', 'outbound');
    if (endParam) query = query.lte('created_at', endParam);
    const { data, error } = await query;
    if (error) return serverError(error);
    const calls = (data ?? []) as Partial<VoiceCall>[];

    // Bucket the hour-of-day chart in the merchant's timezone (server is UTC).
    const tz = await workspaceTimezone(supabaseAdmin(), workspaceId);

    return NextResponse.json(summarizeVoiceCalls(calls, tz));
  } catch (err) {
    return serverError(err, 'voice analytics failed');
  }
}
