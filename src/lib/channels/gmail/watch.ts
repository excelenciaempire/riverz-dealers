/**
 * Gmail push notifications via Cloud Pub/Sub.
 *
 * Setup (one-time, in Google Cloud Console under the OAuth client's
 * project — `riverz-497113`):
 *   1. Create Pub/Sub topic — name must match env GMAIL_PUSH_TOPIC.
 *   2. Grant `gmail-api-push@system.gserviceaccount.com` the
 *      `Pub/Sub Publisher` role on the topic.
 *   3. Create a *push* subscription on that topic with endpoint
 *      `https://<host>/api/channels/gmail/push?secret=<GMAIL_PUSH_SECRET>`.
 *   4. (Optional but recommended) restrict the subscription to OIDC
 *      auth so only Google can post.
 *
 * Runtime:
 *   - When a user connects Gmail (or every 6 days via cron), call
 *     `users.watch` on the mailbox. Gmail stops sending pushes 7 days
 *     after the last watch call, so we re-arm before that.
 *   - Each new email triggers a Pub/Sub message containing only
 *     `{emailAddress, historyId}`. The receiver fetches actual
 *     messages via history.list using the stored cursor — the same
 *     ingest path the polling cron uses.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { decrypt, encrypt } from "../encryption";
import { savePollState } from "../poll-state";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Call users.watch for one Gmail connection. Returns the historyId
 * the watch started from, which is persisted on the connection so
 * the push receiver knows where to resume history.list from.
 */
export async function startGmailWatch(
  admin: SupabaseClient,
  connection: ChannelConnection,
): Promise<{ historyId?: string; expiration?: string; error?: string }> {
  const topic = process.env.GMAIL_PUSH_TOPIC;
  if (!topic) {
    return { error: "GMAIL_PUSH_TOPIC not set" };
  }

  const accessToken = await getFreshAccessToken(admin, connection);
  if (!accessToken) return { error: "no access token" };

  const res = await fetch(`${GMAIL_API}/users/me/watch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      topicName: topic,
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { error: `watch ${res.status}: ${detail}` };
  }
  const j = (await res.json()) as { historyId?: string; expiration?: string };

  // Persist the historyId so the push receiver knows where to resume.
  // Mezclado contra la fila actual: escribir `{ ...config de la foto }`
  // pisaba el progreso que el poll guardó mientras tanto (el historial de 90
  // días volvía a empezar).
  try {
    await savePollState(
      admin,
      connection.id,
      { history_id: j.historyId, watch_expiration: j.expiration },
      null,
      { complete: false },
    );
  } catch (err) {
    return { ...j, error: err instanceof Error ? err.message : String(err) };
  }

  return j;
}

/**
 * Mints (and persists) a fresh access token if the cached one is
 * expired. Lives here too because both the poller and watch use it;
 * we duplicate intentionally rather than reach into poll.ts to keep
 * the watch flow self-contained.
 */
export async function getFreshAccessToken(
  admin: SupabaseClient,
  connection: ChannelConnection,
): Promise<string | null> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const encAccess = String(secrets.access_token ?? "");
  const encRefresh = String(secrets.refresh_token ?? "");
  if (!encAccess) return null;

  const expiresAt = secrets.access_token_expires_at
    ? new Date(String(secrets.access_token_expires_at)).getTime()
    : 0;
  if (expiresAt && expiresAt - 60_000 > Date.now()) return decrypt(encAccess);
  if (!encRefresh) return decrypt(encAccess);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const refreshToken = decrypt(encRefresh);
  const r = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  const fresh = j.access_token;
  if (!fresh) return null;

  const newSecrets = {
    ...secrets,
    access_token: encrypt(fresh),
    access_token_expires_at: new Date(
      Date.now() + Number(j.expires_in ?? 3600) * 1000,
    ).toISOString(),
  };
  await admin
    .from("channel_connections")
    .update({ secrets: newSecrets })
    .eq("id", connection.id);
  return fresh;
}
