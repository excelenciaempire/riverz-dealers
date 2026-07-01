import type { ChannelConnection } from '@/types';
import { decrypt } from './encryption';
import { withAppsecretProofBody } from './meta-graph';

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Hide (or unhide) a comment on the merchant's OWN Instagram/Facebook post via
 * Meta's SANCTIONED moderation API — the official way, not a scrape and not
 * only the native fan-page UI. Instagram uses the `hidden` field; Facebook uses
 * `is_hidden`.
 *
 * Permissions: Instagram needs `instagram_manage_comments` (Advanced Access /
 * App Review — already submitted); Facebook needs `pages_manage_engagement`
 * (no App Review). If the permission isn't granted yet, Meta returns an error
 * and we simply return false — we do NOT flag the connection as broken
 * (messaging still works), so moderation degrades gracefully until App Review
 * clears. Best-effort: never throws.
 */
export async function setCommentHidden(
  connection: ChannelConnection,
  channel: 'ig_comment' | 'fb_comment',
  commentId: string,
  hidden = true,
): Promise<boolean> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const enc = String(secrets.access_token ?? '');
  if (!enc || !commentId) return false;
  const token = decrypt(enc);
  const param =
    channel === 'ig_comment' ? { hidden } : { is_hidden: hidden };
  try {
    const res = await fetch(`${GRAPH}/${commentId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        withAppsecretProofBody({ ...param, access_token: token }, token),
      ),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
