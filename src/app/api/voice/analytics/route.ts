import { NextResponse } from 'next/server';
import type { VoiceCall } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { serverError } from '@/lib/api/errors';

const DEFAULT_TZ = 'America/Bogota';

/** Hour-of-day (0–23) of an ISO timestamp in a specific IANA timezone, so the
 *  "by hour" chart reads in the merchant's wall-clock, not the server's (UTC). */
function hourInTz(iso: string, tz: string): number {
  try {
    const h = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(
        new Date(iso),
      ),
    );
    return Number.isFinite(h) ? h % 24 : new Date(iso).getUTCHours();
  } catch {
    return new Date(iso).getUTCHours();
  }
}

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

  // Range: explicit start/end (dashboard filter) wins; else last N days.
  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
  const since = startParam || new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    let query = supabaseAdmin()
      .from('voice_calls')
      .select(
        'status, outcome, duration_seconds, upsell_amount, cost, city, answered_at, started_at, created_at',
      )
      .eq('workspace_id', workspaceId)
      .eq('direction', 'outbound')
      .gte('created_at', since)
      .limit(10000);
    if (endParam) query = query.lte('created_at', endParam);
    const { data, error } = await query;
    if (error) return serverError(error);
    const calls = (data ?? []) as Partial<VoiceCall>[];

    const total = calls.length;
    const answered = calls.filter((c) => !!c.answered_at).length;
    const confirmed = calls.filter(
      (c) => c.outcome === 'confirmed' || c.outcome === 'recovered',
    ).length;
    const minutes = Math.round(
      calls.reduce((a, c) => a + (c.duration_seconds ?? 0), 0) / 60,
    );
    const upsellRevenue =
      Math.round(calls.reduce((a, c) => a + (Number(c.upsell_amount) || 0), 0) * 100) / 100;
    const cost = Math.round(calls.reduce((a, c) => a + (Number(c.cost?.total_usd) || 0), 0) * 100) / 100;

    // Bucket the hour-of-day chart in the merchant's timezone (server is UTC).
    const { data: ws } = await supabaseAdmin()
      .from('workspaces')
      .select('timezone')
      .eq('id', workspaceId)
      .maybeSingle();
    const tz = (ws as { timezone?: string } | null)?.timezone || DEFAULT_TZ;

    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    const cityMap = new Map<string, { total: number; confirmed: number }>();
    const outcomeMap = new Map<string, number>();

    for (const c of calls) {
      const ts = c.started_at || c.created_at;
      if (ts) {
        const h = hourInTz(ts, tz);
        if (byHour[h]) byHour[h].count++;
      }
      const city = (c.city || '').trim();
      if (city) {
        const cur = cityMap.get(city) ?? { total: 0, confirmed: 0 };
        cur.total++;
        if (c.outcome === 'confirmed' || c.outcome === 'recovered') cur.confirmed++;
        cityMap.set(city, cur);
      }
      const oc = c.outcome || 'no_outcome';
      outcomeMap.set(oc, (outcomeMap.get(oc) ?? 0) + 1);
    }

    const byCity = [...cityMap.entries()]
      .map(([city, v]) => ({ city, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
    const byOutcome = [...outcomeMap.entries()]
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      total,
      answered,
      answered_pct: total ? Math.round((answered / total) * 100) : 0,
      confirmed,
      confirmed_pct: answered ? Math.round((confirmed / answered) * 100) : 0,
      minutes,
      cost,
      upsell_revenue: upsellRevenue,
      by_hour: byHour,
      by_city: byCity,
      by_outcome: byOutcome,
    });
  } catch (err) {
    return serverError(err, 'voice analytics failed');
  }
}
