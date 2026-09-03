import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';

/** Stable internal marker; the UI translates it instead of exposing Meta's
 * technical token failure to the merchant. */
export const META_AUTH_ERROR = 'meta_auth_expired';
/** The Facebook profile may still be valid while no longer being authorized
 * for this exact Page / Instagram business account. */
export const META_ASSET_ACCESS_ERROR = 'meta_asset_access_lost';

/** Includes the old human-readable value so existing rows get the improved
 * UI and can recover without another migration. */
export function isMetaAuthWarning(value: string | null | undefined): boolean {
  return (
    value === META_AUTH_ERROR ||
    /^Token de Meta expirado(?: o sin permisos)?/u.test(value ?? '')
  );
}

export function isMetaAssetAccessWarning(
  value: string | null | undefined
): boolean {
  return value === META_ASSET_ACCESS_ERROR;
}

export function isMetaAccessWarning(value: string | null | undefined): boolean {
  return isMetaAuthWarning(value) || isMetaAssetAccessWarning(value);
}

/**
 * Inspect a Meta Graph API failure response. If it indicates the token
 * is genuinely invalid/expired/revoked, record an actionable warning on the
 * `channel_connections` row. The connection remains `connected`: Meta
 * webhooks do not need the page token, and keeping the row active lets the
 * token-maintenance job repair it instead of turning a temporary permission
 * lapse into a disconnected channel.
 *
 * We require a Meta-shaped auth error — a token-death code (190 access
 * token, 102 API session, 463 expired, 467 invalid) OR a 401 carrying an
 * OAuthException body. A BARE 401 with no/garbled JSON body (proxy or
 * gateway blip) is treated as transient and does NOT set a warning.
 *
 * Non-fatal: any DB error here is swallowed so the caller's own error
 * handling (typically a thrown send-failure) isn't masked.
 */
export async function handleMetaGraphError(
  db: SupabaseClient,
  connection: ChannelConnection,
  status: number,
  parsedBody: { error?: { code?: number; type?: string } } | null
): Promise<void> {
  const err = parsedBody?.error;
  const code = err?.code;
  const isAuthFailure =
    code === 190 ||
    code === 102 ||
    code === 463 ||
    code === 467 ||
    (status === 401 && err?.type === 'OAuthException');
  if (!isAuthFailure) return;
  try {
    await db
      .from('channel_connections')
      .update({
        last_error: META_AUTH_ERROR,
      })
      .eq('id', connection.id);
  } catch {
    /* swallow */
  }
}

/** Safely parse the JSON body of a Meta error response. Returns null
 *  if the body wasn't JSON (rare — Meta errors are always JSON but
 *  network proxies can mangle them). */
export function parseMetaErrorBody(
  bodyText: string
): { error?: { code?: number; type?: string } } | null {
  try {
    return JSON.parse(bodyText) as { error?: { code?: number; type?: string } };
  } catch {
    return null;
  }
}

/** Clear the authorization warning when Meta accepts a request again. The
 * status assignment also revives legacy rows previously marked `error`. */
export async function clearMetaConnectionError(
  db: SupabaseClient,
  connection: ChannelConnection
): Promise<void> {
  try {
    await db
      .from('channel_connections')
      .update({ last_error: null, status: 'connected' })
      .eq('id', connection.id);
  } catch {
    /* swallow */
  }
}
