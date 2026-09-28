import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

export interface PrivateReplyState {
  allowed: boolean;
  revision: string | null;
  brief: string | null;
}
type PrivateIdentity = { workspaceId: string; externalId: string; channel: 'instagram' | 'messenger' };
const unavailable = (): PrivateReplyState => ({ allowed: false, revision: null, brief: null });

/** A reply drafted against an older private turn must not be sent. */
export function privateReplyStateIsCurrent(before: PrivateReplyState, after: PrivateReplyState): boolean {
  return before.allowed && after.allowed && before.revision !== null && before.revision === after.revision;
}

/** A public-comment bot must not bypass ownership of the existing private
 * conversation, even though comment and DM contacts have different row IDs. */
export async function privateConversationAllowsCommentReply(
  db: SupabaseClient,
  args: PrivateIdentity,
): Promise<boolean> {
  return (await readPrivateReplyState(db, args)).allowed;
}

export async function readPrivateReplyState(db: SupabaseClient, args: PrivateIdentity): Promise<PrivateReplyState> {
  try {
    const contacts = await db.from('contacts').select('id')
      .eq('workspace_id', args.workspaceId).eq('channel', args.channel)
      .eq('external_id', args.externalId).limit(20);
    if (contacts.error || contacts.data?.length === 20) return unavailable();
    if (!contacts.data?.length) return { allowed: true, revision: 'no-private-conversation', brief: null };
    const conversations = await db.from('conversations')
      .select('id,ai_enabled,assigned_agent_id,needs_human_reason,status,last_message_at')
      .eq('workspace_id', args.workspaceId).eq('channel', args.channel)
      .in('contact_id', contacts.data.map(c => c.id)).is('deleted_at', null).limit(20);
    if (conversations.error || conversations.data?.length === 20) return unavailable();
    const chats = conversations.data ?? [];
    const allowed = !chats.some(c => c.ai_enabled === false || c.assigned_agent_id || c.needs_human_reason || c.status === 'closed');
    if (!chats.length) return { allowed, revision: 'no-private-conversation', brief: null };
    const history = await db.from('messages').select('id,conversation_id,created_at,sender_type,content_text,held_for_quality')
      .in('conversation_id', chats.map(c => c.id)).in('sender_type', ['customer', 'agent', 'bot'])
      .is('deleted_at', null).neq('status', 'failed')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20);
    if (history.error) return unavailable();
    const messages = history.data ?? [];
    const revision = createHash('sha256').update(JSON.stringify({
      chats: [...chats].sort((a, b) => a.id.localeCompare(b.id)), messages,
    })).digest('hex');
    const text = [...messages].reverse().filter(m => !m.held_for_quality)
      .map(m => `${m.sender_type === 'customer' ? 'Cliente' : 'Tienda'}: ${(m.content_text || '[Adjunto]').slice(0, 600)}`).join('\n');
    return { allowed, revision, brief: text ? `La consulta privada reciente tiene prioridad sobre ofertas y comentarios antiguos. Si ya compró o reclama, atiende ese caso sin reiniciar una venta. Nunca publiques datos personales de este historial.\n${text}` : null };
  } catch { return unavailable(); }
}
