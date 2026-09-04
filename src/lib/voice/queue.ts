/**
 * Voice AI — call queue + compliance gates.
 *
 * `enqueueCall` is the ONE way a call gets created (manual, automation step,
 * follow-up, retry). It never dials inline — it inserts a `queued`
 * voice_calls row with a `scheduled_at` that respects the agent's calling
 * window; the voice-calls cron dispatches due rows. Every guard
 * (kill switch, monthly minutes, opt-out, valid phone, agent enabled) lives
 * here so no caller can bypass compliance.
 */
import { fromZonedTime } from 'date-fns-tz';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Contact,
  VoiceCall,
  VoiceCallType,
  VoiceCallingHours,
  VoiceConnectionConfig,
} from '@/types';
import type { AiAgent } from '@/lib/ai/types';
import { motorApagado } from '@/lib/workspaces/motor';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import {
  DEFAULT_CALLING_HOURS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MINUTES,
} from './constants';

const DEFAULT_TZ = 'America/Bogota';

export interface EnqueueInput {
  workspaceId: string;
  agentId: string;
  contactId: string;
  callType: VoiceCallType;
  /** Destination in E.164; falls back to the contact's phone. */
  phone?: string | null;
  /** Order/cart/objective payload surfaced to the agent. */
  context?: Record<string, unknown>;
  automationId?: string | null;
  /** Retry chain parent (set by the cron on a retry). */
  parentCallId?: string | null;
  attempt?: number;
  maxAttempts?: number;
  language?: string | null;
  /** Skip the calling-window delay (manual "call now" from the UI). */
  immediate?: boolean;
  /** Wait at least this long before the call becomes due. The calling window
   *  still applies on top. Ignored when `immediate`. */
  delayMinutes?: number;
  /**
   * Dejar rastro visible cuando una barrera frena la llamada.
   *
   * Sin esto, un freno de emergencia prendido o un tope de minutos alcanzado
   * hacen que la llamada NO exista en ningún lado: la automatización sigue de
   * largo y el registro de `/voz` está vacío, así que el comercio ve "no pasó
   * nada" y no tiene forma de saber por qué. Con esto queda una fila
   * `canceled` con el motivo, que el registro muestra como «No se llamó · …».
   *
   * Lo prenden las puertas donde hay una persona o una automatización
   * esperando un resultado (el nodo del lienzo, el botón de la bandeja); NO
   * los reintentos ni las campañas, que repetirían la misma fila en bucle.
   */
  recordSkip?: boolean;
}

export type EnqueueResult =
  | { enqueued: true; callId: string; scheduledAt: string }
  | { enqueued: false; reason: string };

/** ISO weekday (1 = Mon … 7 = Sun) of `instant` in `tz`. */
function isoWeekday(tz: string, instant: Date): number {
  const jsDow = new Date(
    instant.toLocaleString('en-US', { timeZone: tz })
  ).getDay(); // 0 = Sun … 6 = Sat
  return jsDow === 0 ? 7 : jsDow;
}

/** Wall-clock YYYY-MM-DD of `instant` in `tz`. */
function ymdInTz(tz: string, instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Minutes-since-midnight of `instant` in `tz`. */
function minutesOfDay(tz: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * The next instant a call may be placed, honoring the calling window in the
 * workspace timezone. Returns `from` when we're already inside the window.
 */
export function nextAllowedTime(
  tz: string,
  hours: VoiceCallingHours,
  from: Date = new Date()
): Date {
  const days = hours.days?.length ? hours.days : DEFAULT_CALLING_HOURS.days;
  // Normalize once and reuse for BOTH the window comparison and the scheduled
  // instant, so an empty/malformed start can't produce an Invalid Date.
  const startStr = hours.start || DEFAULT_CALLING_HOURS.start;
  const startMin = hhmmToMinutes(startStr);
  const endMin = hhmmToMinutes(hours.end || DEFAULT_CALLING_HOURS.end);

  // Already inside a valid window?
  // Si el fin es <= al inicio, la franja cruza medianoche (turno noche,
  // 22:00 → 02:00): además de la parte nocturna del día permitido, cuenta
  // la cola de madrugada que arrancó el día ANTERIOR.
  const todayDow = isoWeekday(tz, from);
  const prevDow = todayDow === 1 ? 7 : todayDow - 1;
  const nowMin = minutesOfDay(tz, from);
  const crossesMidnight = endMin <= startMin;
  const insideNow = crossesMidnight
    ? (days.includes(todayDow) && nowMin >= startMin) ||
      (days.includes(prevDow) && nowMin < endMin)
    : days.includes(todayDow) && nowMin >= startMin && nowMin < endMin;
  if (insideNow) return from;

  // Walk forward up to 8 days to the next allowed day; schedule at `start`.
  let ymd = ymdInTz(tz, from);
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? ymd : (ymd = shiftYmd(ymd, 1));
    const dow = isoWeekday(tz, fromZonedTime(`${candidate}T12:00:00`, tz));
    if (!days.includes(dow)) continue;
    // Today but before the window → open today at start.
    if (i === 0 && nowMin < startMin) {
      return fromZonedTime(`${candidate}T${startStr}:00`, tz);
    }
    // Today but after the window → skip to the next allowed day.
    if (i === 0) continue;
    return fromZonedTime(`${candidate}T${startStr}:00`, tz);
  }
  // Fallback (window misconfigured): 1h from now.
  return new Date(from.getTime() + 60 * 60 * 1000);
}

/** Talk minutes already consumed this calendar month (workspace tz). */
async function minutesUsedThisMonth(
  db: SupabaseClient,
  workspaceId: string,
  tz: string
): Promise<number> {
  const ym = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const monthStart = fromZonedTime(`${ym}-01T00:00:00`, tz).toISOString();
  const { data } = await db
    .from('voice_calls')
    .select('duration_seconds')
    .eq('workspace_id', workspaceId)
    .gte('created_at', monthStart)
    .not('duration_seconds', 'is', null);
  const seconds = (
    (data ?? []) as { duration_seconds: number | null }[]
  ).reduce((acc, r) => acc + (r.duration_seconds ?? 0), 0);
  return seconds / 60;
}

/**
 * Enqueue a voice call. Returns `{ enqueued: false, reason }` when a gate
 * blocks it — callers log the reason but never treat it as an error.
 */
export async function enqueueCall(input: EnqueueInput): Promise<EnqueueResult> {
  const db = supabaseAdmin();

  // Workspace timezone (drives the calling window + monthly metering).
  const { data: ws } = await db
    .from('workspaces')
    .select('timezone')
    .eq('id', input.workspaceId)
    .maybeSingle();
  const tz = (ws as { timezone?: string } | null)?.timezone || DEFAULT_TZ;

  // Se carga TODO primero —conexión, agente, contacto— y recién después se
  // cobran las barreras. Antes cada guard salía al toque, así que cuando el
  // freno de emergencia estaba prendido ni siquiera sabíamos a qué agente ni a
  // qué contacto iba la llamada, y no había con qué dejar la fila que le
  // explica al comercio por qué no sonó el teléfono (`recordSkip`).
  const [{ data: connRow }, { data: agentRow }, { data: contactRow }] =
    await Promise.all([
      db
        .from('channel_connections')
        .select('config, status')
        .eq('workspace_id', input.workspaceId)
        .eq('channel', 'voice')
        .maybeSingle(),
      db
        .from('ai_agents')
        .select('*')
        .eq('id', input.agentId)
        .eq('workspace_id', input.workspaceId)
        .maybeSingle(),
      // Scope by workspace so a caller can't enqueue a call against a contact
      // from another tenant (the dashboard route validates workspace membership
      // + agent ownership, but not the contact).
      db
        .from('contacts')
        .select('*')
        .eq('id', input.contactId)
        .eq('workspace_id', input.workspaceId)
        .maybeSingle(),
    ]);

  const conn = connRow as {
    config: VoiceConnectionConfig | null;
    status: string;
  } | null;
  const cfg = conn?.config ?? {};
  const agent = agentRow as AiAgent | null;
  const contact = contactRow as Contact | null;

  const rawPhone = (input.phone || contact?.phone || '').trim();
  const phoneOk = /^\+?[0-9]{7,15}$/.test(rawPhone.replace(/[^\d+]/g, ''));
  const e164 = rawPhone.startsWith('+')
    ? rawPhone
    : `+${rawPhone.replace(/[^\d]/g, '')}`;

  /**
   * Frenar dejando rastro. La fila `canceled` sólo se puede escribir si hay
   * agente y contacto de verdad (ambos son FK NOT NULL); cuando el bloqueo es
   * justamente que no existen, no hay dónde anotarlo y se devuelve el motivo
   * a secas, como antes.
   */
  const blocked = async (reason: string): Promise<EnqueueResult> => {
    if (input.recordSkip && agent && contact) {
      const { error: skipErr } = await db.from('voice_calls').insert({
        workspace_id: input.workspaceId,
        agent_id: agent.id,
        contact_id: contact.id,
        automation_id: input.automationId ?? null,
        direction: 'outbound',
        call_type: input.callType,
        // El teléfono es NOT NULL; cuando el motivo ES el teléfono, guardar
        // el valor crudo dice más que un guion.
        phone: phoneOk ? e164 : rawPhone || '—',
        language: input.language || agent.language || 'es',
        status: 'canceled',
        error: reason,
        context: input.context ?? {},
        attempt: input.attempt ?? 1,
        max_attempts: 1,
        ended_at: new Date().toISOString(),
      });
      if (skipErr) {
        console.error(
          '[voice] no se pudo registrar la llamada frenada:',
          skipErr
        );
      }
    }
    return { enqueued: false, reason };
  };

  // La cuenta, antes que nada suyo: suspendida por cobro o con el motor
  // apagado esperando aprobación, el teléfono no suena.
  if (await motorApagado(db, input.workspaceId))
    return blocked('motor_apagado');

  // ── Barreras, en orden de qué apaga qué ──
  if (!conn) return blocked('no_voice_connection');
  if (conn.status === 'disconnected') return blocked('voice_disconnected');
  if (!cfg.phone_number) return blocked('no_number');
  if (cfg.kill_switch) return blocked('kill_switch');

  if (!agent) return blocked('agent_not_found');
  if (!agent.voice_enabled) return blocked('voice_disabled');
  // Pausar o borrar un agente frenaba las llamadas ENTRANTES, pero no las
  // salientes disparadas a mano, por una automatización o por una campaña:
  // seguía marcando. Mismo criterio que `pickVoiceAgent`.
  if ((agent as { deleted_at?: string | null }).deleted_at) {
    return blocked('agent_deleted');
  }
  if (!agent.is_active) return blocked('agent_paused');

  if (!contact) return blocked('contact_not_found');
  if (contact.voice_opt_out) return blocked('opt_out');
  if (!phoneOk) return blocked('invalid_phone');

  // Monthly minutes cap.
  const limit = cfg.monthly_minutes_limit ?? null;
  if (limit && limit > 0) {
    const used = await minutesUsedThisMonth(db, input.workspaceId, tz);
    if (used >= limit) return blocked('monthly_limit_reached');
  }

  // Schedule. `delayMinutes` pushes the earliest moment forward before the
  // calling window is applied — used to let a text message have its turn
  // first, so the phone isn't ringing while the WhatsApp is still unread.
  const callingHours = agent.voice_calling_hours || DEFAULT_CALLING_HOURS;
  const earliest =
    input.delayMinutes && input.delayMinutes > 0
      ? new Date(Date.now() + input.delayMinutes * 60_000)
      : new Date();
  const scheduledAt = input.immediate
    ? new Date()
    : nextAllowedTime(tz, callingHours, earliest);

  // attempts = retries + 1; clamp to [1, 6] so an automation config can't
  // request an unbounded dial loop.
  const rawMaxAttempts =
    input.maxAttempts ?? (agent.voice_max_retries ?? DEFAULT_MAX_RETRIES) + 1;
  const maxAttempts = Math.max(1, Math.min(6, Math.floor(rawMaxAttempts) || 1));

  const { data: inserted, error } = await db
    .from('voice_calls')
    .insert({
      workspace_id: input.workspaceId,
      agent_id: input.agentId,
      contact_id: input.contactId,
      automation_id: input.automationId ?? null,
      direction: 'outbound',
      call_type: input.callType,
      phone: e164,
      language: input.language || agent.language || 'es',
      status: 'queued',
      context: input.context ?? {},
      scheduled_at: scheduledAt.toISOString(),
      attempt: input.attempt ?? 1,
      max_attempts: maxAttempts,
      parent_call_id: input.parentCallId ?? null,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    return {
      enqueued: false,
      reason: `insert_failed:${error?.message ?? 'unknown'}`,
    };
  }
  return {
    enqueued: true,
    callId: (inserted as { id: string }).id,
    scheduledAt: scheduledAt.toISOString(),
  };
}

/**
 * Retry delay for the agent, in minutes. Exposed so the result handler and
 * the cron use the same value when scheduling a retry.
 */
export function retryDelayMinutes(
  agent: Pick<AiAgent, 'voice_retry_delay_minutes'>
): number {
  return agent.voice_retry_delay_minutes ?? DEFAULT_RETRY_DELAY_MINUTES;
}

export type { VoiceCall };
