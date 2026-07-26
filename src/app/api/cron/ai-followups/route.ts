import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serverError } from '@/lib/api/errors';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { pingCron } from '@/lib/cron/heartbeat';
import { runFollowUp } from '@/lib/ai/followup';
import { campaignFollowUpHint } from '@/lib/instagram-agent/campaign-followup';
import { runVoiceFollowups } from '@/lib/voice/followup';
import type { AiAgent, BusinessHours } from '@/lib/ai/types';
import type { ChannelConnection, Contact, Conversation } from '@/types';

/**
 * Cron de follow-ups inteligentes.
 *
 * Cada corrida (cada ~30 min) busca, por workspace con al menos un agente
 * `followup_enabled`, las conversaciones donde NOSOTROS hablamos último
 * (last_sender_type bot/agent), el cliente lleva en silencio más que el
 * `followup_delay_hours` del agente, y todavía no llegamos al
 * `followup_max_count` de la racha actual. Para cada una, el asistente
 * redacta un seguimiento contextual y lo envía.
 *
 * Idempotente y auto-reseteable: el conteo se lleva en la conversación
 * (`followup_count` / `followup_last_at`). Si el cliente respondió DESPUÉS
 * del último follow-up, la racha vieja no cuenta (empieza de cero).
 *
 * Solo canales de mensajería directa (no comentarios ni email).
 */

const DM_CHANNELS = ['whatsapp', 'instagram', 'messenger'] as const;
// Ventana de servicio al cliente de Meta: pasado este tiempo desde el último
// mensaje del cliente, solo se permiten plantillas (no texto libre), así que
// el follow-up de la IA queda fuera de cumplimiento y no se envía.
const META_SESSION_WINDOW_HOURS = 24;
// No seguimos conversaciones más viejas que esto (evita revivir hilos muertos).
const MAX_STALE_DAYS = 30;
// Tope por corrida y por workspace.
const PER_WORKSPACE_LIMIT = 200;

type AgentWithChannels = AiAgent & { ai_agent_channels?: { channel: string }[] };

export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  void pingCron('ai-followups');

  const admin = supabaseAdmin();

  const { data: agentRows, error: agentErr } = await admin
    .from('ai_agents')
    .select('*, ai_agent_channels(channel)')
    .eq('is_active', true)
    .eq('followup_enabled', true)
    .is('deleted_at', null);
  if (agentErr) return serverError(agentErr);

  const byWorkspace = new Map<string, AgentWithChannels[]>();
  for (const a of (agentRows ?? []) as AgentWithChannels[]) {
    const list = byWorkspace.get(a.workspace_id) ?? [];
    list.push(a);
    byWorkspace.set(a.workspace_id, list);
  }

  let processed = 0;
  let sent = 0;
  for (const [wsId, agents] of byWorkspace) {
    try {
      const res = await processWorkspace(admin, wsId, agents);
      processed += res.processed;
      sent += res.sent;
    } catch (err) {
      console.error('[cron/ai-followups] workspace failed:', wsId, err);
    }
  }

  // Voice follow-ups: silent chat customers whose agent has voice follow-ups
  // on get ONE call per silence streak. Independent of the text path above
  // (a call isn't bound by Meta's 24h window). Fail-soft.
  const voice = await runVoiceFollowups(admin);

  return NextResponse.json({
    workspaces: byWorkspace.size,
    processed,
    sent,
    voice_calls_enqueued: voice.enqueued,
  });
}

async function processWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
  agents: AgentWithChannels[],
): Promise<{ processed: number; sent: number }> {
  const nowMs = Date.now();
  const minDelayHours = Math.min(
    ...agents.map((a) => Number(a.followup_delay_hours) || 24),
  );
  const cutoff = new Date(nowMs - minDelayHours * 3_600_000).toISOString();
  const floor = new Date(nowMs - MAX_STALE_DAYS * 86_400_000).toISOString();

  const { data: rows, error } = await admin
    .from('conversations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .in('last_sender_type', ['bot', 'agent'])
    .in('channel', DM_CHANNELS as unknown as string[])
    .lt('last_message_at', cutoff)
    .gt('last_message_at', floor)
    .order('last_message_at', { ascending: true })
    .limit(PER_WORKSPACE_LIMIT);
  if (error) throw error;
  const candidates = (rows ?? []) as Conversation[];
  if (candidates.length === 0) return { processed: 0, sent: 0 };

  let sent = 0;
  for (const conv of candidates) {
    const agent = pickAgent(agents, conv.channel);
    if (!agent) continue;

    // Due para ESTE agente (su propio delay).
    const lastMsgMs = conv.last_message_at ? new Date(conv.last_message_at).getTime() : 0;
    const dueMs = nowMs - (Number(agent.followup_delay_hours) || 24) * 3_600_000;
    if (lastMsgMs > dueMs) continue;

    // Respeta "no responder con agente asignado" salvo override.
    if (conv.assigned_agent_id && !agent.reply_when_assigned) continue;

    // Respeta horario de atención.
    if (
      !agent.reply_outside_hours &&
      agent.business_hours &&
      !isWithinHours(agent.business_hours, new Date(nowMs))
    ) {
      continue;
    }

    // Último mensaje del cliente: si nunca escribió, no seguimos (no es
    // outreach en frío). Y sirve para el reset lógico de la racha.
    const { data: lastCustomer } = await admin
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conv.id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastCustomerAt = (lastCustomer as { created_at?: string } | null)?.created_at;
    if (!lastCustomerAt) continue;

    // Conteo efectivo de la racha actual: si seguimos DESPUÉS de su último
    // mensaje, cuenta; si el cliente respondió después, la racha es nueva.
    const followLastMs = conv.followup_last_at
      ? new Date(conv.followup_last_at).getTime()
      : 0;
    const lastCustomerMs = new Date(lastCustomerAt).getTime();

    // Cumplimiento Meta: fuera de la ventana de 24 h desde el ÚLTIMO mensaje
    // del cliente, WhatsApp / Instagram / Messenger solo permiten plantillas
    // aprobadas, no texto libre. El follow-up que redacta la IA es texto
    // libre, así que NO lo enviamos pasada la ventana — lo descartamos en vez
    // de arriesgar un rechazo de la API o una sanción de la plataforma. (El
    // delay del agente está topado a 23 h en la UI para que el follow-up
    // alcance a salir dentro de la ventana.)
    if ((nowMs - lastCustomerMs) / 3_600_000 >= META_SESSION_WINDOW_HOURS) continue;

    const effectiveCount =
      followLastMs > lastCustomerMs ? conv.followup_count ?? 0 : 0;
    if (effectiveCount >= (Number(agent.followup_max_count) || 1)) continue;

    const { data: contactRow } = await admin
      .from('contacts')
      .select('*')
      .eq('id', conv.contact_id)
      .maybeSingle();
    if (!contactRow) continue;

    const connection = await loadConnection(admin, conv, workspaceId);
    if (!connection) continue;

    const silenceHours = Math.max(0, (nowMs - lastMsgMs) / 3_600_000);
    // En Instagram, si la persona viene de una campaña viva, el seguimiento
    // continúa ESA campaña (el "seguimiento si no responden" del plan) en vez
    // de ser un recordatorio genérico.
    const campaignHint =
      conv.channel === 'instagram'
        ? await campaignFollowUpHint(admin, conv.contact_id).catch(() => null)
        : null;

    const result = await runFollowUp(admin, {
      agent,
      conversation: conv,
      contact: contactRow as Contact,
      connection,
      silenceHours,
      campaignHint,
    });

    if (result.sent) {
      sent++;
      await admin
        .from('conversations')
        .update({
          followup_count: effectiveCount + 1,
          followup_last_at: new Date().toISOString(),
        })
        .eq('id', conv.id);
    }
  }

  return { processed: candidates.length, sent };
}

/** Mejor agente followup-enabled para el canal: prioridad desc; los de
 *  scope 'workspace' aplican a todo, los de 'channels' solo a los suyos. */
function pickAgent(
  agents: AgentWithChannels[],
  channel: string,
): AgentWithChannels | null {
  const matches = agents.filter((a) => {
    if (a.scope === 'workspace') return true;
    return (a.ai_agent_channels ?? []).some((c) => c.channel === channel);
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return matches[0];
}

async function loadConnection(
  admin: SupabaseClient,
  conv: Conversation,
  workspaceId: string,
): Promise<ChannelConnection | null> {
  if (conv.connection_id) {
    const { data } = await admin
      .from('channel_connections')
      .select('*')
      .eq('id', conv.connection_id)
      .maybeSingle();
    if (data) return data as ChannelConnection;
  }
  const { data } = await admin
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', conv.channel)
    .neq('status', 'disconnected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ChannelConnection | null) ?? null;
}

/** ¿`date` cae dentro de alguna ventana de `business_hours`? */
function isWithinHours(bh: BusinessHours, date: Date): boolean {
  if (!bh?.windows) return true;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: bh.timezone || 'America/Bogota',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
    let hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
    if (hh === '24') hh = '00';
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const day = dayMap[wd];
    if (day === undefined) return true;
    const windows = bh.windows[day as 0 | 1 | 2 | 3 | 4 | 5 | 6];
    if (!windows || windows.length === 0) return false;
    const cur = `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
    return windows.some((w) => {
      const [a, b] = w.split('-');
      return a && b && cur >= a && cur <= b;
    });
  } catch {
    return true;
  }
}
