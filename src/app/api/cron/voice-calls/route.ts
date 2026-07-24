import { NextResponse } from 'next/server';
import type { VoiceCall, VoiceConnectionConfig } from '@/types';
import { serverError } from '@/lib/api/errors';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { pingCron } from '@/lib/cron/heartbeat';
import {
  dispatchVoiceCall,
  isLiveKitConfigured,
  roomNameForCall,
} from '@/lib/voice/livekit';
import { persistCallResult } from '@/lib/voice/result';

/**
 * Voice calls cron (every minute):
 *   1. Dispatch due `queued` calls — claim atomically, re-check kill switch,
 *      then dispatch the agent to LiveKit (the worker dials via Telnyx).
 *   2. Sweep stuck calls — `dialing`/`in_progress` older than a hard cap
 *      (worker died / never answered the job) → mark failed via the result
 *      handler so retries/triggers stay consistent.
 */

const CLAIM_BATCH = 25;
// Hard ceiling well above any per-agent voice_max_call_seconds (300s default).
const STUCK_AFTER_MS = 20 * 60 * 1000;

export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  void pingCron('voice-calls');

  if (!isLiveKitConfigured()) {
    return NextResponse.json({ skipped: 'livekit_not_configured' });
  }

  const db = supabaseAdmin();
  const nowIso = new Date().toISOString();
  let dispatched = 0;
  let failed = 0;
  let swept = 0;

  try {
    // ── 1. Dispatch due queued calls ──
    const { data: due } = await db
      .from('voice_calls')
      .select('*')
      .eq('status', 'queued')
      .lte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .limit(CLAIM_BATCH);

    for (const row of (due ?? []) as VoiceCall[]) {
      // Claim atomically: only one runner flips queued → dialing.
      const { data: claimed } = await db
        .from('voice_calls')
        .update({
          status: 'dialing',
          started_at: nowIso,
          room_name: roomNameForCall(row.id),
          updated_at: nowIso,
        })
        .eq('id', row.id)
        .eq('status', 'queued')
        .select('id')
        .maybeSingle();
      if (!claimed) continue; // lost the race

      // Re-check the kill switch at dispatch time (it may have flipped since
      // the call was enqueued).
      const { data: conn } = await db
        .from('channel_connections')
        .select('config, status')
        .eq('workspace_id', row.workspace_id)
        .eq('channel', 'voice')
        .maybeSingle();
      const cfg = (conn as { config?: VoiceConnectionConfig } | null)?.config ?? {};
      const connStatus = (conn as { status?: string } | null)?.status;
      if (cfg.kill_switch || connStatus === 'disconnected') {
        await db
          .from('voice_calls')
          .update({ status: 'canceled', ended_at: nowIso, error: 'kill_switch', updated_at: nowIso })
          .eq('id', row.id);
        continue;
      }

      try {
        await dispatchVoiceCall({ callId: row.id, workspaceId: row.workspace_id });
        dispatched++;
      } catch (err) {
        failed++;
        console.error('[cron/voice-calls] dispatch failed:', row.id, err);
        await db
          .from('voice_calls')
          .update({
            status: 'failed',
            ended_at: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }
    }

    // ── 2. Sweep stuck calls ──
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
    const { data: stuck } = await db
      .from('voice_calls')
      .select('id')
      .in('status', ['dialing', 'in_progress'])
      .lt('started_at', stuckBefore)
      .is('ended_at', null)
      .limit(CLAIM_BATCH);
    for (const row of (stuck ?? []) as { id: string }[]) {
      await persistCallResult({
        call_id: row.id,
        status: 'failed',
        ended_at: new Date().toISOString(),
        error: 'worker_timeout',
      }).catch((err) => console.error('[cron/voice-calls] sweep failed:', row.id, err));
      swept++;
    }

    return NextResponse.json({ dispatched, failed, swept });
  } catch (err) {
    return serverError(err, 'voice-calls cron failed');
  }
}
