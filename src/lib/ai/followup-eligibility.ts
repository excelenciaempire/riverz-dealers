import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { AiAgent } from './types';

type Context = {
  agent: AiAgent;
  conversation: Conversation;
  contact: Contact;
  connection: ChannelConnection;
};

export type FollowUpBlock =
  | 'context_mismatch'
  | 'contact_unavailable'
  | 'opted_out'
  | 'conversation_unavailable'
  | 'conversation_ineligible'
  | 'conversation_changed';

export function followUpContextMatches({ agent, conversation, contact, connection }: Context): boolean {
  return agent.workspace_id === conversation.workspace_id
    && contact.workspace_id === agent.workspace_id
    && contact.id === conversation.contact_id
    && connection.workspace_id === agent.workspace_id
    && connection.channel === conversation.channel
    && (!conversation.connection_id || conversation.connection_id === connection.id);
}

type CurrentConversation = Pick<Conversation,
  'channel' | 'connection_id' | 'status' | 'ai_enabled' | 'deleted_at'
  | 'assigned_agent_id' | 'last_message_at' | 'last_sender_type'
  | 'followup_count' | 'followup_last_at'>;

function sameDate(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const subMillisecond = (value: string) => (value.match(/T\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1] ?? '').slice(3).padEnd(6, '0');
  return Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b)
    && subMillisecond(a) === subMillisecond(b);
}

/** Revalidate the candidate before generation and again before proposing/sending.
 * This is a fresh read, not an exclusive claim between concurrent workers. */
export async function followUpBlockReason(db: SupabaseClient, context: Context): Promise<FollowUpBlock | null> {
  if (!followUpContextMatches(context)) return 'context_mismatch';
  const { agent, conversation, contact, connection } = context;
  const [consent, current] = await Promise.all([
    db.from('contacts').select('opted_out')
      .eq('id', contact.id).eq('workspace_id', agent.workspace_id).maybeSingle(),
    db.from('conversations')
      .select('channel,connection_id,status,ai_enabled,deleted_at,assigned_agent_id,last_message_at,last_sender_type,followup_count,followup_last_at')
      .eq('id', conversation.id).eq('workspace_id', agent.workspace_id)
      .eq('contact_id', contact.id).maybeSingle(),
  ]);
  if (consent.error || !consent.data || typeof consent.data.opted_out !== 'boolean') return 'contact_unavailable';
  if (consent.data.opted_out) return 'opted_out';
  if (current.error || !current.data) return 'conversation_unavailable';
  const row = current.data as CurrentConversation;
  if (row.status !== 'open' || row.ai_enabled !== true || row.deleted_at
    || (row.assigned_agent_id && !agent.reply_when_assigned)) return 'conversation_ineligible';
  if (row.channel !== conversation.channel
    || (row.connection_id && row.connection_id !== connection.id)
    || (row.connection_id ?? null) !== (conversation.connection_id ?? null)
    || !['bot', 'agent'].includes(row.last_sender_type ?? '')
    || row.last_sender_type !== conversation.last_sender_type
    || !row.last_message_at
    || !sameDate(row.last_message_at, conversation.last_message_at)
    || (row.followup_count ?? 0) !== (conversation.followup_count ?? 0)
    || !sameDate(row.followup_last_at, conversation.followup_last_at)) return 'conversation_changed';
  return null;
}
