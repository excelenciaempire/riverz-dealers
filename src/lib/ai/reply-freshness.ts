import type { SupabaseClient } from '@supabase/supabase-js';

/** Recheck after send delays and between bubbles, including same-second arrivals. */
export async function replyWasSuperseded(db: SupabaseClient, conversationId: string, inbound: { id: string; created_at: string }): Promise<boolean> {
  const { data, error } = await db.from('messages')
    .select('id,content_text,media_url')
    .eq('conversation_id', conversationId).eq('sender_type', 'customer')
    .or(`created_at.gt.${inbound.created_at},and(created_at.eq.${inbound.created_at},id.gt.${inbound.id})`)
    .limit(20);
  if (error) throw error;
  return (data ?? []).some(m => Boolean(m.content_text?.trim()) || Boolean(m.media_url));
}
