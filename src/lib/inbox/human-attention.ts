import type { SupabaseClient } from '@supabase/supabase-js';

interface Reply {
  conversation_id: string;
  created_at: string;
  sender_type: string;
  status?: string | null;
  origin?: string | null;
  held_for_quality?: boolean | null;
}

/** Close the waiting-for-a-person alert, without enabling AI or closing the chat.
 * The timestamp predicate is atomic: an old delivery receipt cannot clear a new handoff.
 * Fail soft: a sent message must never become a retry/duplicate due to this update.
 */
export async function resolveHumanAttention(db: SupabaseClient, reply: Reply | null): Promise<void> {
  if (!reply || reply.sender_type !== 'agent' || (reply.origin && reply.origin !== 'manual') ||
      !['sent', 'delivered', 'read'].includes(reply.status ?? '') ||
      (reply.held_for_quality && reply.status === 'sent') || !Number.isFinite(Date.parse(reply.created_at))) return;
  try {
    const { error } = await db.from('conversations').update({
      needs_human_reason: null,
      needs_human_at: null,
      needs_human_summary: null,
      needs_human_visto_at: null,
      needs_human_avisado_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', reply.conversation_id).lte('needs_human_at', reply.created_at);
    if (error) console.error('[human-attention] clear failed', error.code);
  } catch { console.error('[human-attention] clear failed'); }
}
