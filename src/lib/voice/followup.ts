/**
 * Voice AI — silence → call follow-up.
 *
 * Runs inside the ai-followups cron. For agents with voice follow-ups on,
 * a customer who went silent on a chat channel (WhatsApp/IG/Messenger) past
 * the agent's follow-up delay gets ONE phone call per silence streak. Unlike
 * the text follow-up, a call is not bound by Meta's 24h session window.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Conversation } from '@/types';
import type { AiAgent } from '@/lib/ai/types';
import { enqueueCall } from './queue';

const CHAT_CHANNELS = ['whatsapp', 'instagram', 'messenger'] as const;
const MAX_STALE_DAYS = 30;
const PER_WORKSPACE_LIMIT = 100;

type AgentWithChannels = AiAgent & { ai_agent_channels?: { channel: string }[] };

function voiceFollowupOn(a: AiAgent): boolean {
  return Boolean(a.voice_enabled && a.voice_objectives?.followup?.enabled);
}

function pickAgent(agents: AgentWithChannels[], channel: string): AgentWithChannels | null {
  const matches = agents.filter(
    (a) =>
      a.scope === 'workspace' ||
      (a.ai_agent_channels ?? []).some((c) => c.channel === channel),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return matches[0];
}

/**
 * Scan every workspace for silent chat conversations whose agent has voice
 * follow-ups enabled, and enqueue one call per streak. Returns a count for
 * the cron log. Never throws.
 */
export async function runVoiceFollowups(
  admin: SupabaseClient,
): Promise<{ enqueued: number }> {
  let enqueued = 0;
  try {
    const { data: agentRows } = await admin
      .from('ai_agents')
      .select('*, ai_agent_channels(channel)')
      .eq('is_active', true)
      .eq('voice_enabled', true)
      .is('deleted_at', null);
    const agents = ((agentRows ?? []) as AgentWithChannels[]).filter(voiceFollowupOn);
    if (agents.length === 0) return { enqueued: 0 };

    const byWorkspace = new Map<string, AgentWithChannels[]>();
    for (const a of agents) {
      const list = byWorkspace.get(a.workspace_id) ?? [];
      list.push(a);
      byWorkspace.set(a.workspace_id, list);
    }

    const nowMs = Date.now();
    for (const [wsId, wsAgents] of byWorkspace) {
      const minDelayHours = Math.min(
        ...wsAgents.map((a) => Number(a.followup_delay_hours) || 24),
      );
      const cutoff = new Date(nowMs - minDelayHours * 3_600_000).toISOString();
      const floor = new Date(nowMs - MAX_STALE_DAYS * 86_400_000).toISOString();

      const { data: rows } = await admin
        .from('conversations')
        .select('*')
        .eq('workspace_id', wsId)
        .eq('status', 'open')
        .is('deleted_at', null)
        .in('last_sender_type', ['bot', 'agent'])
        .in('channel', CHAT_CHANNELS as unknown as string[])
        .lt('last_message_at', cutoff)
        .gt('last_message_at', floor)
        .order('last_message_at', { ascending: true })
        .limit(PER_WORKSPACE_LIMIT);

      for (const conv of (rows ?? []) as Conversation[]) {
        const agent = pickAgent(wsAgents, conv.channel);
        if (!agent) continue;

        const lastMsgMs = conv.last_message_at
          ? new Date(conv.last_message_at).getTime()
          : 0;
        const dueMs = nowMs - (Number(agent.followup_delay_hours) || 24) * 3_600_000;
        if (lastMsgMs > dueMs) continue;

        // Need a real customer turn (not cold outreach) + a phone to call.
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

        const { data: contactRow } = await admin
          .from('contacts')
          .select('*')
          .eq('id', conv.contact_id)
          .maybeSingle();
        const contact = contactRow as Contact | null;
        if (!contact?.phone || contact.voice_opt_out) continue;

        // One call per silence streak: skip if a followup call already exists
        // since the customer's last message.
        const { count } = await admin
          .from('voice_calls')
          .select('id', { count: 'exact', head: true })
          .eq('contact_id', contact.id)
          .eq('call_type', 'followup')
          .gte('created_at', lastCustomerAt);
        if ((count ?? 0) > 0) continue;

        const res = await enqueueCall({
          workspaceId: wsId,
          agentId: agent.id,
          contactId: contact.id,
          callType: 'followup',
          context: {
            conversation_id: conv.id,
            source_channel: conv.channel,
          },
        });
        if (res.enqueued) enqueued++;
      }
    }
  } catch (err) {
    console.error('[voice] runVoiceFollowups failed:', err);
  }
  return { enqueued };
}
