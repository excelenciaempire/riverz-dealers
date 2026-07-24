import { NextResponse } from 'next/server';
import type { VoiceCall } from '@/types';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { assertVoiceWorkerAuth } from '@/lib/voice/auth';
import { buildVoiceContext } from '@/lib/voice/context';
import { resolveInboundCall } from '@/lib/voice/inbound';
import { roomNameForCall } from '@/lib/voice/livekit';

/**
 * GET /api/internal/voice/context
 *   Outbound: ?call_id=<uuid>  → returns the prompt/voice/dial info for a
 *             queued/dispatched call and marks it `dialing`.
 *   Inbound:  ?did=<E164>&caller=<E164> → resolves workspace + agent +
 *             contact, creates an inbound voice_calls row, returns its prompt.
 * Auth: Bearer VOICE_WORKER_SECRET.
 */
export async function GET(request: Request) {
  try {
    assertVoiceWorkerAuth(request);
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const url = new URL(request.url);
  const callId = url.searchParams.get('call_id');
  const did = url.searchParams.get('did');
  const caller = url.searchParams.get('caller');
  const db = supabaseAdmin();

  try {
    let call: VoiceCall;

    if (callId) {
      const { data } = await db
        .from('voice_calls')
        .select('*')
        .eq('id', callId)
        .maybeSingle();
      if (!data) {
        return NextResponse.json({ error: 'call_not_found' }, { status: 404 });
      }
      call = data as VoiceCall;
      // Mark dialing (outbound) — the worker is about to place the call.
      if (call.direction === 'outbound' && call.status === 'queued') {
        await db
          .from('voice_calls')
          .update({
            status: 'dialing',
            started_at: new Date().toISOString(),
            room_name: call.room_name ?? roomNameForCall(call.id),
          })
          .eq('id', call.id);
      }
    } else if (did && caller) {
      const resolved = await resolveInboundCall(db, { did, caller });
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.reason }, { status: 409 });
      }
      call = resolved.call;
    } else {
      return NextResponse.json(
        { error: 'call_id or did+caller required' },
        { status: 400 },
      );
    }

    // Resolve this workspace's voice connection config (caller ID, recording,
    // human-transfer target) for the worker.
    const { data: conn } = await db
      .from('channel_connections')
      .select('config')
      .eq('workspace_id', call.workspace_id)
      .eq('channel', 'voice')
      .maybeSingle();
    const cfg =
      (conn as {
        config?: {
          phone_number?: string;
          recording_enabled?: boolean;
          transfer_number?: string;
        };
      } | null)?.config ?? {};
    const trunkId = process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID ?? null;

    const payload = await buildVoiceContext(db, call, {
      trunkId,
      callerNumber: cfg.phone_number ?? null,
      recordingEnabled: Boolean(cfg.recording_enabled),
      transferNumber: cfg.transfer_number ?? null,
    });
    return NextResponse.json(payload);
  } catch (err) {
    return serverError(err, 'voice context failed');
  }
}
