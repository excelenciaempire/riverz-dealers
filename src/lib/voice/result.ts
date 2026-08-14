/**
 * Voice AI — call result persistence.
 *
 * Called by the worker (POST /api/internal/voice/result) once per call.
 * Idempotent by call_id. Responsibilities:
 *   1. Update the voice_calls state machine (status/outcome/summary/cost).
 *   2. If the call connected, materialize the transcript as a `voice`
 *      conversation + messages so it shows in the unified inbox.
 *   3. Schedule a retry (child row) when the call went unanswered and
 *      attempts remain.
 *   4. Fire the `voice_call_completed` automation trigger once the call
 *      reaches its FINAL state (so "no contestó → WhatsApp" chains work).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  VoiceCall,
  VoiceCallCost,
  VoiceCallOutcome,
  VoiceCallStatus,
} from '@/types';
import { VOICE_UNANSWERED_STATUSES } from '@/types';
import type { AiAgent } from '@/lib/ai/types';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { nextAllowedTime, retryDelayMinutes } from './queue';
import { DEFAULT_CALLING_HOURS } from './constants';
import { maybeCodWriteback } from './cod';

const DEFAULT_TZ = 'America/Bogota';

export interface VoiceTranscriptTurn {
  role: 'agent' | 'customer';
  text: string;
  ts?: string;
}

export interface VoiceResultPayload {
  call_id: string;
  status: VoiceCallStatus;
  outcome?: VoiceCallOutcome | null;
  outcome_details?: Record<string, unknown> | null;
  summary?: string | null;
  transcript?: VoiceTranscriptTurn[];
  answered_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  usage?: {
    stt_seconds?: number;
    llm_input_tokens?: number;
    llm_output_tokens?: number;
    tts_chars?: number;
  } | null;
  /** URL of the recorded audio (LiveKit Egress → storage), if recording was on. */
  recording_url?: string | null;
  error?: string | null;
}

/** Parse an env rate, falling back to `def` on missing/NaN (never poisons cost). */
function envNum(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : def;
}

/** Non-negative finite number, else 0 — worker-supplied usage is untrusted. */
function nn(v: number | null | undefined): number {
  return Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0;
}

/** Rough per-unit rates → estimated USD cost. Reconciled later (fase 2). */
function estimateCost(
  usage: VoiceResultPayload['usage'],
  durationSeconds: number | null,
): VoiceCallCost {
  const minutes = nn(durationSeconds) / 60;
  const sttMin = (usage?.stt_seconds != null ? nn(usage.stt_seconds) : nn(durationSeconds)) / 60;
  const stt_usd = sttMin * envNum('VOICE_STT_USD_PER_MIN', 0.0078);
  const llm_usd =
    (nn(usage?.llm_input_tokens) / 1_000_000) * envNum('VOICE_LLM_IN_USD_PER_MTOK', 1) +
    (nn(usage?.llm_output_tokens) / 1_000_000) * envNum('VOICE_LLM_OUT_USD_PER_MTOK', 5);
  const tts_usd = (nn(usage?.tts_chars) / 1000) * envNum('VOICE_TTS_USD_PER_1K_CHARS', 0.05);
  const telephony_usd = minutes * envNum('VOICE_TELEPHONY_USD_PER_MIN', 0.02);
  const total_usd =
    Math.round((stt_usd + llm_usd + tts_usd + telephony_usd) * 10000) / 10000;
  return {
    stt_usd: Math.round(stt_usd * 10000) / 10000,
    llm_usd: Math.round(llm_usd * 10000) / 10000,
    tts_usd: Math.round(tts_usd * 10000) / 10000,
    telephony_usd: Math.round(telephony_usd * 10000) / 10000,
    total_usd,
    minutes: Math.round(minutes * 100) / 100,
  };
}

/** Find (by workspace) or create the voice channel_connections id. */
async function voiceConnectionId(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await db
    .from('channel_connections')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'voice')
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** One conversation per answered call (call log style). */
async function materializeTranscript(
  db: SupabaseClient,
  call: VoiceCall,
  payload: VoiceResultPayload,
): Promise<string | null> {
  const turns = payload.transcript ?? [];
  const endedAt = payload.ended_at ?? new Date().toISOString();
  const connectionId = await voiceConnectionId(db, call.workspace_id);

  const directionLabel = call.direction === 'inbound' ? 'Llamada entrante' : 'Llamada';
  const subject = call.summary || payload.summary || directionLabel;

  const { data: convo, error: convErr } = await db
    .from('conversations')
    .insert({
      workspace_id: call.workspace_id,
      contact_id: call.contact_id,
      channel: 'voice',
      connection_id: connectionId,
      // One conversation per call (call-log style). Key the thread by the call
      // id so the (workspace, contact, channel, thread) unique index doesn't
      // collide across multiple calls to the same contact.
      thread_external_id: call.id,
      subject: subject.slice(0, 120),
      status: 'open',
      last_message_text: (payload.summary || directionLabel).slice(0, 200),
      last_message_at: endedAt,
      last_sender_type: 'bot',
      unread_count: call.direction === 'inbound' ? 1 : 0,
    })
    .select('id')
    .single();
  if (convErr || !convo) {
    console.error('[voice] create conversation failed:', convErr);
    return null;
  }
  const conversationId = (convo as { id: string }).id;

  if (turns.length > 0) {
    const rows = turns.map((t, i) => ({
      conversation_id: conversationId,
      channel: 'voice',
      sender_type: t.role === 'customer' ? 'customer' : 'bot',
      content_type: 'text',
      content_text: t.text,
      message_id: `voice:${call.id}:${i}`,
      status: 'delivered',
      created_at: t.ts || endedAt,
      // Solo los turnos del agente llevan origen: lo que dijo el cliente no lo
      // envió ninguna funcionalidad (migración 143).
      origin: t.role === 'customer' ? null : 'voice_agent',
    }));
    const { error: msgErr } = await db.from('messages').insert(rows);
    if (msgErr && (msgErr as { code?: string }).code !== '23505') {
      console.error('[voice] insert transcript failed:', msgErr);
    }
  }
  return conversationId;
}

/** Schedule a retry child row when a call went unanswered. */
async function scheduleRetry(
  db: SupabaseClient,
  call: VoiceCall,
  agent: AiAgent,
): Promise<boolean> {
  if (call.attempt >= call.max_attempts) return false;
  const { data: ws } = await db
    .from('workspaces')
    .select('timezone')
    .eq('id', call.workspace_id)
    .maybeSingle();
  const tz = (ws as { timezone?: string } | null)?.timezone || DEFAULT_TZ;
  const delayMs = retryDelayMinutes(agent) * 60 * 1000;
  const earliest = new Date(Date.now() + delayMs);
  const scheduledAt = nextAllowedTime(
    tz,
    agent.voice_calling_hours || DEFAULT_CALLING_HOURS,
    earliest,
  );
  const { error } = await db.from('voice_calls').insert({
    workspace_id: call.workspace_id,
    agent_id: call.agent_id,
    contact_id: call.contact_id,
    automation_id: call.automation_id,
    direction: 'outbound',
    call_type: call.call_type,
    phone: call.phone,
    language: call.language,
    status: 'queued',
    context: call.context ?? {},
    scheduled_at: scheduledAt.toISOString(),
    attempt: call.attempt + 1,
    max_attempts: call.max_attempts,
    parent_call_id: call.id,
  });
  if (error) {
    console.error('[voice] schedule retry failed:', error);
    return false;
  }
  return true;
}

/**
 * Persist a finished call. Idempotent: a second delivery for a call that
 * already has `ended_at` is a no-op (returns ok).
 */
export async function persistCallResult(
  payload: VoiceResultPayload,
): Promise<{ ok: boolean; reason?: string }> {
  const db = supabaseAdmin();

  const { data: callRow } = await db
    .from('voice_calls')
    .select('*')
    .eq('id', payload.call_id)
    .maybeSingle();
  if (!callRow) return { ok: false, reason: 'call_not_found' };
  const call = callRow as VoiceCall;

  // Idempotency: fast path for the already-finalized read, plus an ATOMIC
  // claim so two concurrent POSTs (the worker may retry) can't both proceed —
  // otherwise we'd double-schedule retries and fire the completion trigger
  // twice. Only the writer that flips ended_at from null wins.
  if (call.ended_at) return { ok: true, reason: 'already_finalized' };
  const finalizeTs = payload.ended_at ?? new Date().toISOString();
  const { data: claimed } = await db
    .from('voice_calls')
    .update({ ended_at: finalizeTs, updated_at: finalizeTs })
    .eq('id', call.id)
    .is('ended_at', null)
    .select('id')
    .maybeSingle();
  if (!claimed) return { ok: true, reason: 'already_finalized' };

  const { data: agentRow } = await db
    .from('ai_agents')
    .select('*')
    .eq('id', call.agent_id)
    .maybeSingle();
  const agent = (agentRow as AiAgent | null) ?? null;

  const durationSeconds = payload.duration_seconds ?? null;
  const cost = estimateCost(payload.usage, durationSeconds);
  const connected = call.direction === 'inbound' || (payload.transcript?.length ?? 0) > 0;

  // Materialize the transcript into a conversation when the call connected.
  let conversationId: string | null = call.conversation_id;
  if (connected) {
    conversationId = await materializeTranscript(db, call, payload);
  }

  await db
    .from('voice_calls')
    .update({
      status: payload.status,
      outcome: payload.outcome ?? null,
      outcome_details: payload.outcome_details ?? null,
      summary: payload.summary ?? null,
      conversation_id: conversationId,
      answered_at: payload.answered_at ?? null,
      ended_at: finalizeTs,
      duration_seconds: durationSeconds,
      cost,
      recording_url: payload.recording_url ?? null,
      // Per-city analytics — from the order/shipping context. (upsell_amount is
      // NOT set here: the /tool route stamps it live during the call, so writing
      // null here would clobber it.)
      city: (call.context?.shipping_city as string) || null,
      error: payload.error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', call.id);

  // Opt-out: the customer asked not to be called → stamp the contact.
  if (payload.outcome === 'opt_out') {
    await db
      .from('contacts')
      .update({ voice_opt_out: true })
      .eq('id', call.contact_id);
  }

  // COD write-back (opt-in): tag the Shopify order with the outcome + push a
  // confirmed order to Dropi. No-op unless the workspace enabled it.
  if (payload.status === 'completed' && payload.outcome) {
    void maybeCodWriteback(db, call, payload.outcome).catch((err) =>
      console.error('[voice] COD write-back failed:', err),
    );
  }

  // Retry chain for unanswered outbound calls.
  const unanswered =
    call.direction === 'outbound' &&
    VOICE_UNANSWERED_STATUSES.includes(payload.status);
  let retried = false;
  if (unanswered && agent && payload.outcome !== 'opt_out') {
    retried = await scheduleRetry(db, call, agent);
  }

  // Fire the post-call trigger only when the call reaches its FINAL state:
  // connected/completed, failed, or unanswered with no retry left. This lets
  // "no contestó → WhatsApp" fire exactly once, after all attempts.
  const isFinal = !retried;
  if (isFinal) {
    void runAutomationsForTrigger({
      workspaceId: call.workspace_id,
      triggerType: 'voice_call_completed',
      contactId: call.contact_id,
      context: {
        conversation_id: conversationId ?? undefined,
        vars: {
          call_type: call.call_type,
          call_status: payload.status,
          call_outcome: payload.outcome ?? 'no_outcome',
          call_duration: durationSeconds ?? 0,
          call_summary: payload.summary ?? '',
        },
      },
    }).catch((err) => console.error('[voice] post-call automations failed:', err));
  }

  return { ok: true };
}
