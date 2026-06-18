import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The most recent inbound (customer) message of a contact — i.e. the
 * comment / story reply / DM that the person actually wrote. This is the
 * per-person engagement signal that powers lead scoring AND the
 * personalized DM (we reply to what they really said, like Blueberry's
 * "Hey Sarah! Percy is so cute 🐶" referencing their comment).
 *
 * Returns null when the contact has no inbound message yet.
 */
export async function latestInboundText(
  db: SupabaseClient,
  contactId: string,
): Promise<string | null> {
  const { data: convs } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId);
  const convIds = (convs ?? []).map((c) => (c as { id: string }).id);
  if (convIds.length === 0) return null;

  const { data: msgs } = await db
    .from('messages')
    .select('content_text')
    .in('conversation_id', convIds)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1);
  const top = (msgs ?? [])[0] as { content_text: string | null } | undefined;
  return top?.content_text ?? null;
}
