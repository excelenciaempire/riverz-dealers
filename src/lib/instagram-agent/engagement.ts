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

/** Meta's private-reply window: 7 days since the comment was posted. */
export const COMMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** True if a free-form DM is allowed right now (last inbound within 24h). */
export function withinMessagingWindow(at: string | null): boolean {
  if (!at) return false;
  return Date.now() - new Date(at).getTime() < MESSAGING_WINDOW_MS;
}

/** True if a private reply to a comment is still allowed (within 7 days). */
export function withinCommentWindow(at: string | null): boolean {
  if (!at) return false;
  return Date.now() - new Date(at).getTime() < COMMENT_WINDOW_MS;
}

/**
 * How (and whether) we can reach this person on Instagram RIGHT NOW.
 *
 *   dm            — they messaged us in the last 24h: free-form DM allowed.
 *   private_reply — they commented in the last 7 days: the ONLY sanctioned way
 *                   to reach them is a private reply carrying the comment id.
 *                   Their comment-author id is not a messageable IGSID, and a
 *                   comment does NOT open the 24h messaging window, so a plain
 *                   `{ id }` send is rejected by Meta.
 *   none          — both windows are closed (or they never engaged).
 */
export type IgReach =
  | { kind: 'dm'; at: string }
  | { kind: 'private_reply'; commentId: string; at: string }
  | { kind: 'none'; reason: 'outside_24h_window' | 'outside_comment_window' | 'no_engagement' };

/**
 * Resolve the reachable channel for a contact, preferring a real DM window
 * (free-form, richer) over a comment private reply.
 */
export async function resolveIgReach(
  db: SupabaseClient,
  contactId: string,
): Promise<IgReach> {
  const { data: convs } = await db
    .from('conversations')
    .select('id, channel')
    .eq('contact_id', contactId)
    .in('channel', ['instagram', 'ig_comment']);
  const rows = (convs ?? []) as Array<{ id: string; channel: string }>;
  const dmIds = rows.filter((c) => c.channel === 'instagram').map((c) => c.id);
  const commentIds = rows.filter((c) => c.channel === 'ig_comment').map((c) => c.id);

  let sawEngagement = false;
  let dmExpired = false;

  if (dmIds.length > 0) {
    const { data } = await db
      .from('messages')
      .select('created_at')
      .in('conversation_id', dmIds)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1);
    const at = ((data ?? [])[0] as { created_at: string } | undefined)?.created_at ?? null;
    if (at) {
      sawEngagement = true;
      if (withinMessagingWindow(at)) return { kind: 'dm', at };
      dmExpired = true;
    }
  }

  if (commentIds.length > 0) {
    const { data } = await db
      .from('messages')
      .select('message_id, created_at')
      .in('conversation_id', commentIds)
      .eq('sender_type', 'customer')
      .not('message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    const top = (data ?? [])[0] as
      | { message_id: string | null; created_at: string }
      | undefined;
    if (top?.message_id) {
      sawEngagement = true;
      if (withinCommentWindow(top.created_at)) {
        return { kind: 'private_reply', commentId: top.message_id, at: top.created_at };
      }
      return { kind: 'none', reason: 'outside_comment_window' };
    }
  }

  if (dmExpired) return { kind: 'none', reason: 'outside_24h_window' };
  return { kind: 'none', reason: sawEngagement ? 'outside_24h_window' : 'no_engagement' };
}
