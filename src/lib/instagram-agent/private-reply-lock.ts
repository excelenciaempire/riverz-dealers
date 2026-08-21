import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The single private reply Meta allows per Instagram comment.
 *
 * Two independent paths fire on the same inbound comment — the comment-to-DM
 * rule engine and the campaign instant-outreach loop — and each can send a
 * private reply (`recipient: { comment_id }`). Meta permits only ONE private
 * reply per comment, so we gate both behind a shared claim: whichever inserts
 * the (workspace, comment) row first wins and sends; the other sees the unique
 * conflict and skips. Race-safe because it's a single unique insert, so it
 * holds even though both callers run fire-and-forget with no ordering.
 *
 * Requires the service-role client (the ingest paths run without a session).
 */
export async function claimCommentPrivateReply(
  db: SupabaseClient,
  workspaceId: string,
  commentExternalId: string,
  /** 'human' = alguien del equipo escribió al privado desde la bandeja. */
  claimedBy: 'campaign' | 'rule' | 'human',
): Promise<boolean> {
  const { error } = await db.from('ig_private_reply_claims').insert({
    workspace_id: workspaceId,
    comment_external_id: commentExternalId,
    claimed_by: claimedBy,
  });
  // Unique violation (23505) → another path already claimed this comment.
  return !error;
}
