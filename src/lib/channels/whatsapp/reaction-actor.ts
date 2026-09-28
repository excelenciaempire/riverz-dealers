import type { SupabaseClient } from '@supabase/supabase-js';

/** Exact international identity variants, never suffix-only phone matching. */
export function reactionIdentityCandidates(from: string): string[] {
  const digits = from.replace(/\D/g, '');
  return /^549\d{10}$/.test(digits) ? [digits, `54${digits.slice(3)}`] : [digits];
}

/** The reaction actor must be the customer of the targeted, scoped thread. */
export async function whatsappReactionActor(db: SupabaseClient, workspaceId: string, conversationId: string, from: string): Promise<string | null> {
  const conversation = await db.from('conversations').select('contact_id')
    .eq('id', conversationId).eq('workspace_id', workspaceId).maybeSingle();
  if (conversation.error) throw new Error('reaction_conversation_lookup_failed');
  const id = conversation.data?.contact_id;
  if (!id) return null;
  const contact = await db.from('contacts').select('id')
    .eq('id', id).eq('workspace_id', workspaceId).eq('channel', 'whatsapp')
    .in('external_id', reactionIdentityCandidates(from)).maybeSingle();
  if (contact.error) throw new Error('reaction_contact_lookup_failed');
  return contact.data?.id ?? null;
}
