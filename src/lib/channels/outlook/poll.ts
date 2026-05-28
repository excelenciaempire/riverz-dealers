import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import type { InboundEvent } from "../types";
import { ingestInboundEvent } from "../inbox-writer";
import { decrypt, encrypt } from "../encryption";
import { supabaseAdmin } from "../admin-client";

/**
 * Microsoft Graph polls every connected Outlook/Hotmail mailbox via
 * `/me/messages` (filtered to Inbox + receivedDateTime newer than the
 * stored cursor) and ingests anything not yet seen. Dedup falls out of
 * the unique index on `messages.message_id`.
 *
 * Mirrors the Gmail poller intentionally so the cron infra stays
 * symmetrical — both run every 5 minutes and write `last_synced_at`.
 *
 * Cursor: `config.last_received_at` — ISO timestamp of the newest
 * message we ingested. First poll falls back to "last 7 days" so a
 * freshly connected mailbox shows a real backlog instead of an empty
 * inbox on day one.
 */

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const OAUTH_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

interface PollSummary {
  connectionId: string;
  email: string;
  ingested: number;
  error?: string;
}

export async function pollAllOutlookConnections(): Promise<PollSummary[]> {
  const admin = supabaseAdmin();
  const { data: connections, error } = await admin
    .from("channel_connections")
    .select("*")
    .eq("channel", "outlook")
    .eq("status", "connected");
  if (error) throw new Error(`[outlook-poll] list connections: ${error.message}`);
  if (!connections || connections.length === 0) return [];

  const out: PollSummary[] = [];
  for (const c of connections as ChannelConnection[]) {
    const email = String(
      (c.config ?? {}).email ?? c.external_account_id ?? c.label ?? "",
    );
    try {
      const ingested = await pollOne(admin, c);
      out.push({ connectionId: c.id, email, ingested });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.push({ connectionId: c.id, email, ingested: 0, error: msg });
      await admin
        .from("channel_connections")
        .update({ last_error: msg.slice(0, 500) })
        .eq("id", c.id);
    }
  }
  return out;
}

async function pollOne(
  admin: SupabaseClient,
  connection: ChannelConnection,
): Promise<number> {
  const accessToken = await getFreshAccessToken(admin, connection);
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const cursor = cfg.last_received_at ? String(cfg.last_received_at) : "";

  // 7-day backlog on first poll, 1-day sliding window after that. The
  // unique index on messages.message_id makes overlap free.
  const sinceMs = cursor
    ? new Date(cursor).getTime()
    : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const since = new Date(sinceMs).toISOString();

  const u = new URL(`${GRAPH_API}/me/mailFolders/inbox/messages`);
  u.searchParams.set(
    "$select",
    "id,internetMessageId,conversationId,from,toRecipients,subject,bodyPreview,body,receivedDateTime,isRead",
  );
  u.searchParams.set("$top", "50");
  u.searchParams.set("$orderby", "receivedDateTime asc");
  u.searchParams.set("$filter", `receivedDateTime gt ${since}`);

  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`messages.list ${r.status}: ${detail}`);
  }
  const j = (await r.json()) as { value?: GraphMessage[] };
  const messages = j.value ?? [];

  if (messages.length === 0) {
    await admin
      .from("channel_connections")
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", connection.id);
    return 0;
  }

  let ingested = 0;
  let maxReceived = sinceMs;
  for (const msg of messages) {
    if (msg.receivedDateTime) {
      const t = new Date(msg.receivedDateTime).getTime();
      if (t > maxReceived) maxReceived = t;
    }
    const event = buildInboundEvent(connection, msg);
    if (!event) continue;
    const result = await ingestInboundEvent(admin, event);
    if (result) ingested++;
  }

  const newConfig = { ...cfg, last_received_at: new Date(maxReceived).toISOString() };
  await admin
    .from("channel_connections")
    .update({
      config: newConfig,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", connection.id);
  return ingested;
}

async function getFreshAccessToken(
  admin: SupabaseClient,
  connection: ChannelConnection,
): Promise<string> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const encAccess = String(secrets.access_token ?? "");
  const encRefresh = String(secrets.refresh_token ?? "");
  if (!encAccess) throw new Error("connection missing access_token");

  const expiresAt = secrets.access_token_expires_at
    ? new Date(String(secrets.access_token_expires_at)).getTime()
    : 0;
  const stillValid = expiresAt && expiresAt - 60_000 > Date.now();
  if (stillValid) return decrypt(encAccess);

  if (!encRefresh) {
    return decrypt(encAccess);
  }

  const refreshToken = decrypt(encRefresh);
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("MICROSOFT_CLIENT_ID/SECRET missing — cannot refresh");
  }
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
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`refresh failed (${r.status}): ${detail}`);
  }
  const json = (await r.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const fresh = json.access_token;
  if (!fresh) throw new Error("refresh response missing access_token");

  const newSecrets: Record<string, unknown> = {
    ...secrets,
    access_token: encrypt(fresh),
    access_token_expires_at: new Date(
      Date.now() + Number(json.expires_in ?? 3600) * 1000,
    ).toISOString(),
  };
  // Microsoft sometimes rotates the refresh token; persist when present.
  if (json.refresh_token) {
    newSecrets.refresh_token = encrypt(json.refresh_token);
  }
  await admin
    .from("channel_connections")
    .update({ secrets: newSecrets })
    .eq("id", connection.id);
  return fresh;
}

interface GraphMessage {
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

function buildInboundEvent(
  connection: ChannelConnection,
  msg: GraphMessage,
): InboundEvent | null {
  const from = msg.from?.emailAddress;
  const email = from?.address?.toLowerCase();
  if (!email) return null;

  const html = msg.body?.contentType === "html" ? msg.body.content ?? "" : "";
  const text = msg.body?.contentType === "text" ? msg.body.content ?? "" : "";
  return {
    channel: "outlook",
    connection,
    externalContactId: email,
    contactName: from?.name || undefined,
    externalMessageId: msg.internetMessageId || msg.id,
    externalThreadId: msg.conversationId,
    subject: msg.subject ?? "",
    text: text || stripHtml(html) || msg.bodyPreview || "",
    htmlBody: html || undefined,
    receivedAt: msg.receivedDateTime ?? new Date().toISOString(),
    raw: { graphId: msg.id },
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
