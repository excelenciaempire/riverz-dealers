import type { SupabaseClient } from '@supabase/supabase-js';

interface Reply {
  id?: string;
  conversation_id: string;
  created_at: string;
  sender_type: string;
  status?: string | null;
  origin?: string | null;
  held_for_quality?: boolean | null;
}

async function isLatestMessage(db: SupabaseClient, reply: Reply): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('id,created_at,sender_type,status,origin,held_for_quality')
    .eq('conversation_id', reply.conversation_id)
    .neq('status', 'failed')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  if (reply.id && data.id) return data.id === reply.id;
  return data.created_at === reply.created_at && data.sender_type === reply.sender_type;
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
    // A manual answer only resolves the alert while it is still the newest
    // turn. If the customer wrote again during delivery, that new request must
    // remain visible in "Needs a human".
    if (!(await isLatestMessage(db, reply))) return;
    const { error } = await db.from('conversations').update({
      needs_human_reason: null,
      needs_human_at: null,
      needs_human_summary: null,
      needs_human_visto_at: null,
      needs_human_avisado_at: null,
      updated_at: new Date().toISOString(),
    })
      .eq('id', reply.conversation_id)
      .lte('needs_human_at', reply.created_at)
      .lte('last_message_at', reply.created_at);
    if (error) console.error('[human-attention] clear failed', error.code);
  } catch { console.error('[human-attention] clear failed'); }
}

/** A verified closing message (thanks, goodbye, "that's all") also ends a
 * stale alert. The AI classifier calls this only after reading the full turn;
 * this function still verifies that no newer message arrived meanwhile. */
export async function resolveHumanAttentionFromCustomerClosure(
  db: SupabaseClient,
  reply: Reply | null,
): Promise<void> {
  if (!reply || reply.sender_type !== 'customer' || !reply.id ||
      !Number.isFinite(Date.parse(reply.created_at))) return;
  try {
    if (!(await isLatestMessage(db, reply))) return;
    const { error } = await db.from('conversations').update({
      needs_human_reason: null,
      needs_human_at: null,
      needs_human_summary: null,
      needs_human_visto_at: null,
      needs_human_avisado_at: null,
      updated_at: new Date().toISOString(),
    })
      .eq('id', reply.conversation_id)
      .lte('needs_human_at', reply.created_at)
      .lte('last_message_at', reply.created_at);
    if (error) console.error('[human-attention] closure clear failed', error.code);
  } catch { console.error('[human-attention] closure clear failed'); }
}
