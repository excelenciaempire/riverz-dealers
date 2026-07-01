import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The most recent inbound (customer) message of a contact — its text AND
 * timestamp. The text is the per-person engagement signal that powers lead
 * scoring AND the personalized DM (we reply to what they really said, like
 * Blueberry's "Hey Sarah! Percy is so cute 🐶"). The timestamp is what gates
 * Meta's 24h messaging window before we send a free-form DM.
 *
 * Both fields are null when the contact has no inbound message yet.
 */
export async function latestInbound(
  db: SupabaseClient,
  contactId: string,
): Promise<{ text: string | null; at: string | null }> {
  const { data: convs } = await db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId);
  const convIds = (convs ?? []).map((c) => (c as { id: string }).id);
  if (convIds.length === 0) return { text: null, at: null };

  const { data: msgs } = await db
    .from('messages')
    .select('content_text, created_at')
    .in('conversation_id', convIds)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1);
  const top = (msgs ?? [])[0] as
    | { content_text: string | null; created_at: string | null }
    | undefined;
  return { text: top?.content_text ?? null, at: top?.created_at ?? null };
}

/** Convenience: just the text of the most recent inbound message. */
export async function latestInboundText(
  db: SupabaseClient,
  contactId: string,
): Promise<string | null> {
  return (await latestInbound(db, contactId)).text;
}

/** Meta's free-form messaging window: 24h since the customer's last message. */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True if a free-form DM is allowed right now (last inbound within 24h). */
export function withinMessagingWindow(at: string | null): boolean {
  if (!at) return false;
  return Date.now() - new Date(at).getTime() < MESSAGING_WINDOW_MS;
}
