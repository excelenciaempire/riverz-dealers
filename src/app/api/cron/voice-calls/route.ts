import { NextResponse } from 'next/server';
import type { VoiceCall, VoiceConnectionConfig } from '@/types';
import { serverError } from '@/lib/api/errors';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { withCronRun } from '@/lib/cron/heartbeat';
import { puertaDeIa } from '@/lib/wallet/puerta';
import {
  dispatchVoiceCall,
  isLiveKitConfigured,
  roomNameForCall,
} from '@/lib/voice/livekit';
import { voiceWorkerDown as workerDown } from '@/lib/voice/readiness';
import {
  recordingExists,
  recordingKey,
  transcribeRecording,
} from '@/lib/voice/rescate';
import { persistCallResult } from '@/lib/voice/result';
import { fairVoiceQueue } from '@/lib/voice/capacity';
import {
  nextAllowedTime,
  voiceBalanceHoldExpiry,
  voiceHoldExpired,
} from '@/lib/voice/queue';
import { voiceExecutionMeta } from '@/lib/voice/execution-context';
import { DEFAULT_CALLING_HOURS } from '@/lib/voice/constants';
import { voiceProviderHealth } from '@/lib/voice/provider-health';

/**
 * Voice calls cron (every minute):
 *   1. Dispatch due `queued` calls — claim atomically, re-check kill switch,
 *      then dispatch the agent to LiveKit (the worker dials via Telnyx).
 *   2. Sweep stuck calls — `dialing`/`in_progress` older than a hard cap
 *      (worker died / never answered the job) → mark failed via the result
 *      handler so retries/triggers stay consistent.
 */

const CLAIM_BATCH = 25;
const QUEUE_SCAN = 100;
// Hard ceiling well above any per-agent voice_max_call_seconds (300s default).
const STUCK_AFTER_MS = 20 * 60 * 1000;

/**
 * Did the customer write to us after this call was queued?
 *
 * Only asked for calls that exist as a fallback to a message. `sender_type`
 * distinguishes a real reply from our own outbound, and the voice channel is
 * excluded so a previous call's transcript doesn't read as an answer.
 */
async function customerRepliedSince(
  db: ReturnType<typeof supabaseAdmin>,
  call: VoiceCall
): Promise<boolean> {
  const { data: convs } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', call.contact_id)
    .neq('channel', 'voice')
    .limit(20);
  const ids = ((convs ?? []) as { id: string }[]).map((c) => c.id);
  if (ids.length === 0) return false;

  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .eq('sender_type', 'customer')
    .gt('created_at', call.created_at);
  return (count ?? 0) > 0;
}

/**
 * Cancelar una llamada que ya no se va a hacer, SIN dejar dormida a la
 * automatización que la estaba esperando.
 *
 * Los tres motivos de cancelación (kill switch, opt-out, el cliente ya
 * contestó) escribían el estado directo sobre `voice_calls` y seguían de
 * largo. Una corrida estacionada sobre esa llamada no se enteraba nunca y
 * quedaba dormida hasta el tope de 24 h: el WhatsApp de "si no contesta"
 * salía un día después, cuando el motivo real era que el cliente ya había
 * respondido. Pasar por `persistCallResult` la despierta enseguida y por la
 * rama correcta, además de dejar el resultado registrado como cualquier otra
 * llamada terminada.
 */
async function cancelCall(
  call: VoiceCall,
  reason:
    | 'kill_switch'
    | 'opt_out'
    | 'customer_replied'
    | 'sin_saldo'
    | 'suscripcion_vencida'
    | 'saldo_timeout'
): Promise<void> {
  await persistCallResult({
    call_id: call.id,
    status: 'canceled',
    ended_at: new Date().toISOString(),
    error: reason,
  }).catch((err) =>
    console.error(
      '[cron/voice-calls] cancel-persist failed:',
      call.id,
      reason,
      err
    )
  );
}

async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  if (!isLiveKitConfigured()) {
    return NextResponse.json({ skipped: 'livekit_not_configured' });
  }

  const db = supabaseAdmin();

  // Sin worker no se despacha NADA. `dispatchVoiceCall` tiene éxito igual —
  // LiveKit encola el trabajo y espera a alguien que lo tome—, así que la fila
  // pasaba a `dialing`, nadie la atendía y a los 20 minutos el barrido la
  // cerraba como `worker_timeout`: la llamada se perdía y el cliente nunca
  // supo que lo iban a llamar. Dejarlas en `queued` las hace salir solas
  // cuando el worker vuelve. Con retraso, que es infinitamente mejor.
  if (await workerDown(db)) {
    return NextResponse.json({ skipped: 'worker_down' });
  }
  if ((await voiceProviderHealth(db)).blocking) {
    return NextResponse.json({ skipped: 'provider_unavailable' });
  }
  const nowIso = new Date().toISOString();
  let dispatched = 0;
  let failed = 0;
  let swept = 0;
  let capacityHeld = 0;

  try {
    // ── 1. Dispatch due queued calls ──
    const { data: due } = await db
      .from('voice_calls')
      .select('*')
      .eq('status', 'queued')
      .lte('scheduled_at', nowIso)
      .order('dispatch_priority', { ascending: false })
      .order('scheduled_at', { ascending: true })
      .limit(QUEUE_SCAN);

    const globalLimit = Math.max(
      1,
      Math.min(250, Number(process.env.VOICE_GLOBAL_CONCURRENCY_LIMIT) || 10)
    );
    for (const row of fairVoiceQueue((due ?? []) as VoiceCall[])) {
      if (dispatched >= CLAIM_BATCH) break;

      if (row.hold_reason) {
        if (voiceHoldExpired(row.hold_expires_at)) {
          await cancelCall(row, 'saldo_timeout');
          continue;
        }
        const wallet = await puertaDeIa(db, row.workspace_id);
        if (!wallet.puede) continue;

        // A recharge can happen after today's calling window closed. Reapply
        // the same agent hours before releasing the parked call.
        const [{ data: agentHours }, { data: workspace }] = await Promise.all([
          db
            .from('ai_agents')
            .select('voice_calling_hours')
            .eq('id', row.agent_id)
            .maybeSingle(),
          db
            .from('workspaces')
            .select('timezone')
            .eq('id', row.workspace_id)
            .maybeSingle(),
        ]);
        const next = nextAllowedTime(
          (workspace as { timezone?: string } | null)?.timezone ||
            'America/Bogota',
          (
            agentHours as {
              voice_calling_hours?: typeof DEFAULT_CALLING_HOURS;
            } | null
          )?.voice_calling_hours || DEFAULT_CALLING_HOURS,
          new Date()
        );
        await db
          .from('voice_calls')
          .update({
            hold_reason: null,
            hold_expires_at: null,
            scheduled_at: next.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        if (next.getTime() > Date.now() + 1000) continue;
      }

      // Capacity + queued→dialing happen inside one database transaction.
      // When all slots are busy the row stays queued; lack of capacity is not
      // a failed customer call and must never trigger retries or fallbacks.
      const { data: claimRows, error: claimError } = await db.rpc(
        'claim_voice_call_with_capacity',
        {
          p_call_id: row.id,
          p_room_name: roomNameForCall(row.id),
          p_global_limit: globalLimit,
        }
      );
      if (claimError) {
        console.error(
          '[cron/voice-calls] capacity claim failed:',
          row.id,
          claimError
        );
        continue;
      }
      const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as {
        claimed?: boolean;
        reason?: string | null;
      } | null;
      if (!claim?.claimed) {
        if (
          claim?.reason?.includes('capacity') ||
          claim?.reason === 'inbound_reserved'
        ) {
          capacityHeld++;
        }
        if (claim?.reason === 'global_capacity') break;
        continue;
      }

      // Re-check the kill switch at dispatch time (it may have flipped since
      // the call was enqueued).
      const { data: conn } = await db
        .from('channel_connections')
        .select('config, status')
        .eq('workspace_id', row.workspace_id)
        .eq('channel', 'voice')
        .maybeSingle();
      const cfg =
        (conn as { config?: VoiceConnectionConfig } | null)?.config ?? {};
      const connStatus = (conn as { status?: string } | null)?.status;
      if (cfg.kill_switch || connStatus === 'disconnected') {
        await cancelCall(row, 'kill_switch');
        continue;
      }

      // Sin saldo o con la suscripcion vencida no se marca: una llamada gasta
      // telefonia, modelo y voz, y es el gasto mas caro de todos. Vuelve a la
      // cola en vez de cancelarse — en cuanto recargue, sale sola.
      const wallet = await puertaDeIa(db, row.workspace_id);
      if (!wallet.puede) {
        const origin = voiceExecutionMeta(row.context)?.origin;
        const automatic =
          origin === 'automation' ||
          origin === 'campaign' ||
          Boolean(row.parent_call_id);
        if (!automatic || wallet.motivo !== 'sin_saldo') {
          await cancelCall(row, wallet.motivo ?? 'sin_saldo');
          continue;
        }
        await db
          .from('voice_calls')
          .update({
            status: 'queued',
            started_at: null,
            room_name: null,
            hold_reason: 'sin_saldo',
            hold_expires_at: voiceBalanceHoldExpiry(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        continue;
      }

      // Re-check opt-out at dispatch: the contact may have opted out AFTER the
      // call was queued (or between retries). Compliance-critical.
      const { data: contactRow } = await db
        .from('contacts')
        .select('voice_opt_out')
        .eq('id', row.contact_id)
        .maybeSingle();
      if ((contactRow as { voice_opt_out?: boolean } | null)?.voice_opt_out) {
        await cancelCall(row, 'opt_out');
        continue;
      }

      // Calls queued as a BACKUP to a message (cart recovery) drop themselves
      // when the message already worked. Without this the customer answered
      // the WhatsApp, bought, and got phoned about the cart anyway hours
      // later — the single fastest way to make the feature feel dumb.
      if (
        row.context?.skip_if_replied &&
        (await customerRepliedSince(db, row))
      ) {
        await cancelCall(row, 'customer_replied');
        continue;
      }

      try {
        await dispatchVoiceCall({
          callId: row.id,
          workspaceId: row.workspace_id,
        });
        dispatched++;
      } catch (err) {
        failed++;
        console.error('[cron/voice-calls] dispatch failed:', row.id, err);
        // Route through the result handler (same as the stuck-call sweep) so a
        // transient dispatch error still fires voice_call_completed and the
        // retry/fallback chain stays consistent instead of dead-ending.
        await persistCallResult({
          call_id: row.id,
          status: 'failed',
          ended_at: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        }).catch((e) =>
          console.error('[cron/voice-calls] fail-persist failed:', row.id, e)
        );
      }
    }

    // ── 2. Sweep stuck calls ──
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
    const { data: stuck } = await db
      .from('voice_calls')
      .select('id, direction, language, started_at')
      .in('status', ['dialing', 'in_progress'])
      .lt('started_at', stuckBefore)
      .is('ended_at', null)
      .limit(CLAIM_BATCH);
    for (const row of (stuck ?? []) as {
      id: string;
      direction: string;
      language: string | null;
      started_at: string | null;
    }[]) {
      // Antes de darla por perdida, mirar si quedó el audio.
      //
      // El egress sube directo de LiveKit a Storage, sin pasar por el worker,
      // así que una llamada que se cortó porque el worker murió TIENE su .ogg
      // aunque no haya reportado nada. Cerrarla a secas dejaba una fila
      // «Fallida» sin una palabra y sin grabación enlazada, con el audio de una
      // conversación entera ahí al lado. Se reconstruye lo que se pueda.
      let transcript: Awaited<ReturnType<typeof transcribeRecording>> = null;
      let recordingUrl: string | null = null;
      try {
        if (await recordingExists(db, row.id)) {
          recordingUrl = recordingKey(row.id);
          transcript = await transcribeRecording(db, row.id, {
            language: row.language ?? 'es',
            direction: row.direction,
          });
        }
      } catch (err) {
        console.error('[cron/voice-calls] rescate falló:', row.id, err);
      }

      const conecto = (transcript?.length ?? 0) > 0;
      const ended = new Date();
      await persistCallResult({
        call_id: row.id,
        // Con transcripción rescatada la llamada SÍ se atendió: marcarla
        // `failed` mentiría igual que antes, sólo que ahora tenemos la prueba.
        // El motivo queda igual para que se vea que se cortó de nuestro lado.
        status: conecto ? 'completed' : 'failed',
        ended_at: ended.toISOString(),
        answered_at: conecto ? row.started_at : null,
        duration_seconds:
          conecto && row.started_at
            ? Math.max(
                0,
                Math.round(
                  (ended.getTime() - new Date(row.started_at).getTime()) / 1000
                )
              )
            : null,
        transcript: transcript ?? undefined,
        recording_url: recordingUrl,
        error: conecto
          ? 'worker_timeout: la llamada se cortó de nuestro lado; transcripción rescatada del audio'
          : 'worker_timeout',
      }).catch((err) =>
        console.error('[cron/voice-calls] sweep failed:', row.id, err)
      );
      swept++;
    }

    return NextResponse.json({
      dispatched,
      failed,
      swept,
      capacity_held: capacityHeld,
    });
  } catch (err) {
    return serverError(err, 'voice-calls cron failed');
  }
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun('voice-calls', cronHandler);
