/**
 * Microsoft Graph change-notification subscriptions for Outlook
 * mailboxes — the push equivalent of Gmail's Pub/Sub watch. Without
 * this, Outlook would only flow into the inbox on the 5-minute poll
 * cron; with it the latency drops to single-digit seconds.
 *
 * Subscriptions on `/me/mailFolders('inbox')/messages` have a 3-day
 * maximum lifetime; we renew every ~2 days via a separate cron (see
 * `/api/cron/outlook-watch`).
 *
 * Required env:
 *   - OUTLOOK_PUSH_CLIENT_STATE  — shared secret echoed in every
 *     notification so the receiver can confirm it really came from
 *     Graph. Generate a long random string and store in Render.
 *   - The deployed app's public URL is derived from request origin at
 *     creation time, so no separate URL env is needed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import { decrypt, encrypt } from "../encryption";

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const OAUTH_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * Create or refresh a Graph push subscription for one Outlook
 * connection. If a subscription_id is already stored, this PATCHes its
 * expirationDateTime instead of creating a new one — cheaper and keeps
 * the existing subscription id stable.
 */
export async function startOutlookWatch(
  admin: SupabaseClient,
  connection: ChannelConnection,
  notificationUrl: string,
): Promise<{ subscriptionId?: string; expiration?: string; error?: string }> {
  const clientState = process.env.OUTLOOK_PUSH_CLIENT_STATE;
  if (!clientState) {
    return { error: "OUTLOOK_PUSH_CLIENT_STATE not set" };
  }

  const accessToken = await getFreshAccessToken(admin, connection);
  if (!accessToken) return { error: "no access token" };

  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const existingId = cfg.subscription_id ? String(cfg.subscription_id) : "";

  // Graph max for /messages is 3 days from now (4230 minutes), but
  // subscriptions also can't extend beyond 3 days from creation. We
  // request 2d 22h to leave headroom for clock drift and renew jitter.
  const expirationDateTime = new Date(
    Date.now() + (2 * 24 + 22) * 60 * 60 * 1000,
  ).toISOString();

  let res: Response;
  if (existingId) {
    res = await fetch(`${GRAPH_API}/subscriptions/${existingId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expirationDateTime }),
    });
    if (res.status === 404) {
      // Subscription was deleted (expired beyond grace, revoked, etc).
      // Fall through to creation below.
      res = await createSubscription(accessToken, notificationUrl, clientState, expirationDateTime);
    }
  } else {
    res = await createSubscription(accessToken, notificationUrl, clientState, expirationDateTime);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { error: `subscriptions ${res.status}: ${detail}` };
  }
  const j = (await res.json()) as { id?: string; expirationDateTime?: string };

  await admin
    .from("channel_connections")
    .update({
      config: {
        ...cfg,
        subscription_id: j.id,
        subscription_expiration: j.expirationDateTime,
      },
    })
    .eq("id", connection.id);

  return { subscriptionId: j.id, expiration: j.expirationDateTime };
}

async function createSubscription(
  accessToken: string,
  notificationUrl: string,
  clientState: string,
  expirationDateTime: string,
): Promise<Response> {
  return fetch(`${GRAPH_API}/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      changeType: "created",
      notificationUrl,
      resource: "/me/mailFolders('inbox')/messages",
      expirationDateTime,
      clientState,
    }),
  });
}

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

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
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
      scope: "offline_access Mail.ReadWrite Mail.Send User.Read",
    }).toString(),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const fresh = j.access_token;
  if (!fresh) return null;

  const newSecrets: Record<string, unknown> = {
    ...secrets,
    access_token: encrypt(fresh),
    access_token_expires_at: new Date(
      Date.now() + Number(j.expires_in ?? 3600) * 1000,
    ).toISOString(),
  };
  if (j.refresh_token) newSecrets.refresh_token = encrypt(j.refresh_token);

  await admin
    .from("channel_connections")
    .update({ secrets: newSecrets })
    .eq("id", connection.id);
  return fresh;
}

/**
 * Fetch a single message by Graph id and turn it into the InboundEvent
 * shape the inbox-writer expects. Reused from the notification handler
 * and any future backfill code.
 */
export async function fetchOutlookMessage(
  accessToken: string,
  graphMessageId: string,
): Promise<GraphMessageFull | null> {
  const u = new URL(`${GRAPH_API}/me/messages/${graphMessageId}`);
  u.searchParams.set(
    "$select",
    "id,internetMessageId,conversationId,from,toRecipients,subject,bodyPreview,body,receivedDateTime,isRead",
  );
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return (await r.json()) as GraphMessageFull;
}

export interface GraphMessageFull {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  receivedDateTime?: string;
  isRead?: boolean;
}
