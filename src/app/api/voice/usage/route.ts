import { NextResponse } from 'next/server';
import type { VoiceCall, VoiceConnectionConfig } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { serverError } from '@/lib/api/errors';
import { traerTodo } from '@/lib/db/paginar';

/**
 * GET /api/voice/usage?workspace_id=
 * Current calendar-month talk minutes + estimated spend vs the monthly cap.
 * Session-authenticated (workspace member). Powers the usage bar on the Voice
 * card. Month boundary is UTC — the cap is a soft guardrail, exactness isn't
 * needed.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });

  const { data: member } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const data = await traerTodo<{ duration_seconds: number | null; cost: number | null }>(
      (d, h) =>
        supabaseAdmin()
          .from('voice_calls')
          .select('duration_seconds, cost')
          .eq('workspace_id', workspaceId)
          .gte('created_at', monthStart)
          .order('id', { ascending: true })
          .range(d, h),
    );
    const error = null;
    if (error) return serverError(error);
    const calls = (data ?? []) as Pick<VoiceCall, 'duration_seconds' | 'cost'>[];

    const seconds = calls.reduce((a, c) => a + (c.duration_seconds ?? 0), 0);
    const minutesUsed = Math.round(seconds / 60);
    const spendUsd =
      Math.round(calls.reduce((a, c) => a + (Number(c.cost?.total_usd) || 0), 0) * 100) / 100;

    // Monthly cap lives on the voice channel_connections config.
    const { data: conn } = await supabaseAdmin()
      .from('channel_connections')
      .select('config')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'voice')
      .maybeSingle();
    const cfg = (conn as { config?: VoiceConnectionConfig } | null)?.config ?? {};
    const minutesLimit = Number(cfg.monthly_minutes_limit) || 0;

    return NextResponse.json({
      minutes_used: minutesUsed,
      minutes_limit: minutesLimit, // 0 = unlimited
      spend_usd: spendUsd,
      calls: calls.length,
    });
  } catch (err) {
    return serverError(err, 'voice usage failed');
  }
}
