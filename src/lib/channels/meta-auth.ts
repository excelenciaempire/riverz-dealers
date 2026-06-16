import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";

/**
 * Inspect a Meta Graph API failure response. If it indicates the token
 * is genuinely invalid/expired/revoked, flip the `channel_connections`
 * row to `status='error'` with a human-readable `last_error`. The
 * Settings → Canales card already renders `last_error` for non-connected
 * rows (channels-panel.tsx), so this side effect turns invisible token
 * death into a visible "Reconectar" CTA.
 *
 * We require a Meta-shaped auth error — a token-death code (190 access
 * token, 102 API session, 463 expired, 467 invalid) OR a 401 carrying an
 * OAuthException body. A BARE 401 with no/garbled JSON body (proxy or
 * gateway blip) is treated as transient and does NOT flip: flipping on a
 * transient failure used to make the connection deaf to inbound messages
 * (the webhook router skips non-connected rows) with no auto-recovery.
 *
 * Non-fatal: any DB error here is swallowed so the caller's own error
 * handling (typically a thrown send-failure) isn't masked.
 */
export async function handleMetaGraphError(
  db: SupabaseClient,
  connection: ChannelConnection,
  status: number,
  parsedBody: { error?: { code?: number; type?: string } } | null,
): Promise<void> {
  const err = parsedBody?.error;
  const code = err?.code;
  const isAuthFailure =
    code === 190 ||
    code === 102 ||
    code === 463 ||
    code === 467 ||
    (status === 401 && err?.type === "OAuthException");
  if (!isAuthFailure) return;
  try {
    await db
      .from("channel_connections")
      .update({
        status: "error",
        last_error: "Token de Meta expirado — reconectar desde Ajustes › Canales",
      })
      .eq("id", connection.id);
  } catch {
    /* swallow */
  }
}

/** Safely parse the JSON body of a Meta error response. Returns null
 *  if the body wasn't JSON (rare — Meta errors are always JSON but
 *  network proxies can mangle them). */
export function parseMetaErrorBody(
  bodyText: string,
): { error?: { code?: number; type?: string } } | null {
  try {
    return JSON.parse(bodyText) as { error?: { code?: number; type?: string } };
  } catch {
    return null;
  }
}

/** Clear `last_error` and `status='error'` when a Meta call now
 *  succeeds — restores the green dot once the user reconnects. */
export async function clearMetaConnectionError(
  db: SupabaseClient,
  connection: ChannelConnection,
): Promise<void> {
  try {
    await db
      .from("channel_connections")
      .update({ last_error: null, status: "connected" })
      .eq("id", connection.id)
      .eq("status", "error");
  } catch {
    /* swallow */
  }
}
