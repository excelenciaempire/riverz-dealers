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
}

export type EnqueueResult =
  | { enqueued: true; callId: string; scheduledAt: string }
  | { enqueued: false; reason: string };

/** ISO weekday (1 = Mon … 7 = Sun) of `instant` in `tz`. */
function isoWeekday(tz: string, instant: Date): number {
  const jsDow = new Date(
    instant.toLocaleString('en-US', { timeZone: tz }),
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
  from: Date = new Date(),
): Date {
  const days = hours.days?.length ? hours.days : DEFAULT_CALLING_HOURS.days;
  const startMin = hhmmToMinutes(hours.start || DEFAULT_CALLING_HOURS.start);
  const endMin = hhmmToMinutes(hours.end || DEFAULT_CALLING_HOURS.end);

  // Already inside a valid window today?
  const todayDow = isoWeekday(tz, from);
  const nowMin = minutesOfDay(tz, from);
  if (days.includes(todayDow) && nowMin >= startMin && nowMin < endMin) {
    return from;
  }

  // Walk forward up to 8 days to the next allowed day; schedule at `start`.
  let ymd = ymdInTz(tz, from);
  for (let i = 0; i < 8; i++) {
    const candidate = i === 0 ? ymd : (ymd = shiftYmd(ymd, 1));
    const dow = isoWeekday(tz, fromZonedTime(`${candidate}T12:00:00`, tz));
    if (!days.includes(dow)) continue;
    // Today but before the window → open today at start.
    if (i === 0 && nowMin < startMin) {
      return fromZonedTime(`${candidate}T${hours.start}:00`, tz);
    }
    // Today but after the window → skip to the next allowed day.
    if (i === 0) continue;
    return fromZonedTime(`${candidate}T${hours.start}:00`, tz);
  }
  // Fallback (window misconfigured): 1h from now.
  return new Date(from.getTime() + 60 * 60 * 1000);
}

/** Talk minutes already consumed this calendar month (workspace tz). */
async function minutesUsedThisMonth(
  db: SupabaseClient,
  workspaceId: string,
  tz: string,
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
  const seconds = ((data ?? []) as { duration_seconds: number | null }[]).reduce(
    (acc, r) => acc + (r.duration_seconds ?? 0),
    0,
  );
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

  // Voice connection config (kill switch / limit / caller number).
  const { data: connRow } = await db
    .from('channel_connections')
    .select('config, status')
    .eq('workspace_id', input.workspaceId)
    .eq('channel', 'voice')
    .maybeSingle();
  if (!connRow) return { enqueued: false, reason: 'no_voice_connection' };
  const conn = connRow as { config: VoiceConnectionConfig | null; status: string };
  const cfg = conn.config ?? {};
  if (conn.status === 'disconnected') {
    return { enqueued: false, reason: 'voice_disconnected' };
  }
  if (cfg.kill_switch) return { enqueued: false, reason: 'kill_switch' };

  // Agent must exist + have voice enabled.
  const { data: agentRow } = await db
    .from('ai_agents')
    .select('*')
    .eq('id', input.agentId)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle();
  if (!agentRow) return { enqueued: false, reason: 'agent_not_found' };
  const agent = agentRow as AiAgent;
  if (!agent.voice_enabled) return { enqueued: false, reason: 'voice_disabled' };

  // Contact + opt-out + phone.
  const { data: contactRow } = await db
    .from('contacts')
    .select('*')
    .eq('id', input.contactId)
    .maybeSingle();
  if (!contactRow) return { enqueued: false, reason: 'contact_not_found' };
  const contact = contactRow as Contact;
  if (contact.voice_opt_out) return { enqueued: false, reason: 'opt_out' };

  const phone = (input.phone || contact.phone || '').trim();
  if (!/^\+?[0-9]{7,15}$/.test(phone.replace(/[^\d+]/g, ''))) {
    return { enqueued: false, reason: 'invalid_phone' };
  }
  const e164 = phone.startsWith('+') ? phone : `+${phone.replace(/[^\d]/g, '')}`;

  // Monthly minutes cap.
  const limit = cfg.monthly_minutes_limit ?? null;
  if (limit && limit > 0) {
    const used = await minutesUsedThisMonth(db, input.workspaceId, tz);
    if (used >= limit) return { enqueued: false, reason: 'monthly_limit_reached' };
  }

  // Schedule.
  const callingHours = agent.voice_calling_hours || DEFAULT_CALLING_HOURS;
  const scheduledAt = input.immediate
    ? new Date()
    : nextAllowedTime(tz, callingHours);

  const maxAttempts =
    input.maxAttempts ??
    (agent.voice_max_retries ?? DEFAULT_MAX_RETRIES) + 1; // attempts = retries + 1

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
    return { enqueued: false, reason: `insert_failed:${error?.message ?? 'unknown'}` };
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
export function retryDelayMinutes(agent: Pick<AiAgent, 'voice_retry_delay_minutes'>): number {
  return agent.voice_retry_delay_minutes ?? DEFAULT_RETRY_DELAY_MINUTES;
}

export type { VoiceCall };
