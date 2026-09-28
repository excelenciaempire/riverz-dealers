import type { SupabaseClient } from '@supabase/supabase-js';

/** A public-comment bot must not bypass ownership of the existing private
 * conversation, even though comment and DM contacts have different row IDs. */
export async function privateConversationAllowsCommentReply(
  db: SupabaseClient,
  args: { workspaceId: string; externalId: string; channel: 'instagram' | 'messenger' },
): Promise<boolean> {
  try {
    const contacts = await db.from('contacts').select('id')
      .eq('workspace_id', args.workspaceId).eq('channel', args.channel)
      .eq('external_id', args.externalId).limit(20);
    if (contacts.error || contacts.data?.length === 20) return false;
    if (!contacts.data?.length) return true;
    const conversations = await db.from('conversations')
      .select('ai_enabled,assigned_agent_id,needs_human_reason,status')
      .eq('workspace_id', args.workspaceId).eq('channel', args.channel)
      .in('contact_id', contacts.data.map(c => c.id)).is('deleted_at', null).limit(20);
    if (conversations.error || conversations.data?.length === 20) return false;
    return !(conversations.data ?? []).some(c => c.ai_enabled === false || c.assigned_agent_id || c.needs_human_reason || c.status === 'closed');
  } catch { return false; }
}
