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
import {
  runAutomationsForTrigger,
  resumeAfterVoiceCall,
} from '@/lib/automations/engine';
import { ensureTag, applyTags } from '@/lib/contacts/tags';
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
 * Plain-Spanish outcome wording for the two places a call result has to be
 * READ rather than displayed: the contact's memory (which the text agent gets
 * as prompt context) and the auto-tag. Deliberately NOT the i18n catalog —
 * that one renders UI in the merchant's language, while these strings feed
 * the model and the tag list, which are Spanish throughout the app.
 */
const OUTCOME_WORDING: Record<VoiceCallOutcome, { memory: string; tag: string }> = {
  confirmed: { memory: 'confirmó el pedido', tag: 'confirmado' },
  cancelled_by_customer: { memory: 'canceló el pedido', tag: 'cancelado' },
  rescheduled: { memory: 'pidió reprogramar la entrega', tag: 'reprogramado' },
  recovered: { memory: 'retomó la compra', tag: 'recuperado' },
  declined: { memory: 'no quiso avanzar', tag: 'rechazado' },
  callback_requested: { memory: 'pidió que lo llamen después', tag: 'volver-a-llamar' },
  opt_out: { memory: 'pidió no recibir más llamadas', tag: 'no-llamar' },
  no_outcome: { memory: 'sin resultado claro', tag: 'sin-resultado' },
};

/** Cap on `contacts.ai_summary`: it is re-sent on EVERY prompt, so it can't grow forever. */
const CONTACT_MEMORY_MAX_CHARS = 2000;

/**
 * Ids de TODOS los intentos de esta llamada, del último al primero.
 *
 * Un reintento no reusa la fila: `scheduleRetry` inserta una `voice_calls`
 * nueva encadenada por `parent_call_id`. Una automatización que quedó
 * esperando se estacionó sobre el id del PRIMER intento, así que buscar sólo
 * por el id actual no la encontraba nunca. `max_attempts` está topeado en 6,
 * así que la cadena es corta por construcción; el tope del bucle es una red
 * contra un ciclo imposible en los datos.
 */
async function callAttemptChain(
  db: SupabaseClient,
  call: VoiceCall,
): Promise<string[]> {
  const ids = [call.id];
  let parent = call.parent_call_id ?? null;
  for (let i = 0; i < 8 && parent; i += 1) {
    ids.push(parent);
    const { data } = await db
      .from('voice_calls')
      .select('parent_call_id')
      .eq('id', parent)
      .maybeSingle();
    parent = (data as { parent_call_id?: string | null } | null)?.parent_call_id ?? null;
  }
  return ids;
}

/**
 * Fold what happened on the phone into the contact's memory, so the TEXT
 * agent knows about it the next time this person writes on WhatsApp.
 * Without this the call was a dead end: the transcript lived in its own
 * `voice` conversation and nothing that builds the chat prompt ever read it.
 *
 * Written deterministically rather than through `summarizeContactIfNeeded`:
 * that one needs an Anthropic key and ≥5 messages of history, so a first call
 * to a brand-new contact — exactly the case that matters — would silently
 * write nothing. The LLM summarizer still consolidates this text later, on
 * its own cadence, when the contact keeps chatting.
 */
async function absorbCallIntoContact(
  db: SupabaseClient,
  call: VoiceCall,
  payload: VoiceResultPayload,
): Promise<void> {
  const summary = (payload.summary ?? '').trim();
  const outcome = payload.outcome ?? null;
  if (!summary && !outcome) return;

  const { data } = await db
    .from('contacts')
    .select('ai_summary')
    .eq('id', call.contact_id)
    .maybeSingle();
  const prior = ((data as { ai_summary?: string | null } | null)?.ai_summary ?? '').trim();

  const when = (payload.ended_at ?? new Date().toISOString()).slice(0, 10);
  const direction = call.direction === 'inbound' ? 'Llamada entrante' : 'Llamada';
  const outcomeText = outcome ? ` — ${OUTCOME_WORDING[outcome].memory}` : '';
  const line = `${direction} del ${when}${outcomeText}${summary ? `: ${summary}` : '.'}`;

  // Newest first, then truncate: the recent call matters more than an old one,
  // and this keeps the field from growing without bound across many calls.
  const next = [line, prior].filter(Boolean).join('\n').slice(0, CONTACT_MEMORY_MAX_CHARS);

  await db
    .from('contacts')
    .update({ ai_summary: next, last_ai_conversation_at: new Date().toISOString() })
    .eq('id', call.contact_id);
}

/**
 * Tag the contact with how the call went, so the outcome is filterable in
 * Contactos and usable as a segment — the same place the Shopify categories
 * land. One tag per outcome family, previous call tags cleared first so a
 * customer who cancelled and later confirmed doesn't carry both.
 */
async function tagContactForOutcome(
  db: SupabaseClient,
  call: VoiceCall,
  outcome: VoiceCallOutcome,
): Promise<void> {
  const name = `llamada:${OUTCOME_WORDING[outcome].tag}`;

  // Drop the contact's other `llamada:` tags — they describe a call that
  // already happened and a stale one reads as the current state.
  const { data: stale } = await db
    .from('tags')
    .select('id, name')
    .eq('workspace_id', call.workspace_id)
    .like('name', 'llamada:%');
  const staleIds = ((stale ?? []) as { id: string; name: string }[])
    .filter((t) => t.name !== name)
    .map((t) => t.id);
  if (staleIds.length) {
    await db
      .from('contact_tags')
      .delete()
      .eq('contact_id', call.contact_id)
      .in('tag_id', staleIds);
  }

  const tagId = await ensureTag(db, call.workspace_id, name);
  await applyTags(db, call.contact_id, [tagId]);
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

  /**
   * ¿El agente llegó a hablar?
   *
   * El saludo lo dice el TTS con un texto de la configuración: sale aunque el
   * modelo esté caído. Si el modelo no puede pensar —la clave sin saldo, el
   * proveedor caído— la llamada conecta, se oye el saludo, nadie responde, y a
   * los ~20 s el guardia de silencio cuelga. El worker reporta `completed`.
   *
   * Medido en producción el 2026-08-25: Cerebras devolvía 402 y salieron cuatro
   * llamadas «completadas» de 19 segundos donde el cliente escuchó un saludo y
   * silencio. El comercio las paga, y la automatización toma la rama
   * «contestó», que es la peor de las dos.
   *
   * Un turno del agente EN LA TRANSCRIPCIÓN es la única prueba de que el modelo
   * respondió: el saludo no aparece ahí porque no lo generó el modelo.
   */
  const agenteHablo = (payload.transcript ?? []).some(
    (t) => t.role === 'agent' && (t.text ?? '').trim() !== '',
  );

  // Materialize the transcript into a conversation when the call connected.
  let conversationId: string | null = call.conversation_id;
  if (connected) {
    conversationId = await materializeTranscript(db, call, payload);
  }

  // Una llamada que conectó pero en la que el agente nunca dijo una palabra no
  // es una llamada contestada: es una llamada fallida que suena a contestada.
  // Se guarda como `failed` con el motivo, para que el registro lo muestre y
  // para que la rama «si no contesta» de la automatización sea la que corra.
  const mudo =
    payload.status === 'completed' && connected && !agenteHablo && !payload.summary;
  const statusFinal = mudo ? 'failed' : payload.status;
  const errorFinal = mudo
    ? payload.error || 'agent_silent: el modelo no respondió durante la llamada'
    : payload.error ?? null;
  if (mudo) {
    console.error(
      '[voice] llamada sin una sola respuesta del agente — revisar el LLM:',
      call.id,
    );
  }

  await db
    .from('voice_calls')
    .update({
      status: statusFinal,
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
      error: errorFinal,
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
  if (statusFinal === 'completed' && payload.outcome) {
    void maybeCodWriteback(db, call, payload.outcome).catch((err) =>
      console.error('[voice] COD write-back failed:', err),
    );
  }

  // Retry chain for unanswered outbound calls.
  const unanswered =
    call.direction === 'outbound' &&
    VOICE_UNANSWERED_STATUSES.includes(statusFinal);
  let retried = false;
  if (unanswered && agent && payload.outcome !== 'opt_out') {
    retried = await scheduleRetry(db, call, agent);
  }

  // Fire the post-call trigger only when the call reaches its FINAL state:
  // connected/completed, failed, or unanswered with no retry left. This lets
  // "no contestó → WhatsApp" fire exactly once, after all attempts.
  const isFinal = !retried;
  if (isFinal) {
    const resultVars: Record<string, unknown> = {
      call_type: call.call_type,
      call_status: statusFinal,
      call_outcome: payload.outcome ?? 'no_outcome',
      call_duration: durationSeconds ?? 0,
      call_summary: payload.summary ?? '',
    };

    // An automation PARKED on this call resumes here — that's what makes
    // "llamar; si no contesta, mandar WhatsApp" work as a single automation.
    // Separate from the trigger below, which STARTS a new automation rather
    // than continuing a suspended one. Both paths stay supported.
    //
    // Se pasa la CADENA de intentos, no sólo este id: la corrida se estacionó
    // sobre el primer intento y acá reporta el último.
    void callAttemptChain(db, call)
      .then((ids) => resumeAfterVoiceCall(ids, resultVars))
      .catch((err) =>
        console.error('[voice] resume parked automation failed:', err),
      );

    void runAutomationsForTrigger({
      workspaceId: call.workspace_id,
      triggerType: 'voice_call_completed',
      contactId: call.contact_id,
      context: {
        conversation_id: conversationId ?? undefined,
        vars: resultVars,
      },
    }).catch((err) => console.error('[voice] post-call automations failed:', err));
  }

  // What was said on the phone has to reach the TEXT agent, or the customer
  // repeats the whole thing tomorrow on WhatsApp. Both writes are
  // fire-and-forget: a summary that fails must never fail the call.
  if (connected) {
    void absorbCallIntoContact(db, call, payload).catch((err) =>
      console.error('[voice] contact memory failed:', err),
    );
  }
  if (payload.outcome && payload.outcome !== 'no_outcome') {
    void tagContactForOutcome(db, call, payload.outcome).catch((err) =>
      console.error('[voice] outcome tag failed:', err),
    );
  }

  return { ok: true };
}
