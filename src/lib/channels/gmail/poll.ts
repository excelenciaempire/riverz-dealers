import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelConnection } from "@/types";
import type { InboundEvent } from "../types";
import { ingestInboundEvent } from "../inbox-writer";
import { decrypt, encrypt } from "../encryption";
import { supabaseAdmin } from "../admin-client";

/**
 * Gmail does not push inbound mail without a Pub/Sub topic. To avoid
 * forcing Cloud Pub/Sub setup on every workspace, the unified inbox
 * polls each connected mailbox via `users.messages.list` and ingests
 * anything not already in `messages` (dedup is the unique index on
 * `messages.message_id`).
 *
 * Cursor is `config.history_id`, refreshed each run from the newest
 * message's historyId. First poll falls back to `q=newer_than:1d` so a
 * freshly connected account picks up the last day of mail.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface PollSummary {
  connectionId: string;
  email: string;
  ingested: number;
  error?: string;
}

export async function pollAllGmailConnections(): Promise<PollSummary[]> {
  const admin = supabaseAdmin();
  const { data: connections, error } = await admin
    .from("channel_connections")
    .select("*")
    .eq("channel", "gmail")
    .eq("status", "connected");
  if (error) throw new Error(`[gmail-poll] list connections: ${error.message}`);
  if (!connections || connections.length === 0) return [];

  const out: PollSummary[] = [];
  for (const c of connections as ChannelConnection[]) {
    const email = String((c.config ?? {}).email ?? c.external_account_id ?? c.label ?? "");
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
  const lastHistoryId = cfg.history_id ? String(cfg.history_id) : "";

  // messages.list every run with a sliding 1-day window. The unique
  // index on messages.message_id makes re-ingest a no-op, so overlap
  // is free — and this avoids the history.list edge cases (cursor too
  // old, label filter mismatches) that silently returned 0 even when
  // the inbox had fresh mail.
  //
  // On a freshly-connected mailbox we widen to 7d so the user sees a
  // realistic backlog instead of an empty inbox on day one.
  const window = lastHistoryId ? "newer_than:1d" : "newer_than:7d";
  const inboxIds = await listMessageIdsViaQuery(accessToken, `in:inbox ${window}`);
  // Also pull recently-sent mail so the agent's own replies (including
  // ones sent straight from Gmail, outside this app) show in the thread.
  const sentIds = await listMessageIdsViaQuery(accessToken, `in:sent ${window}`);

  if (inboxIds.length === 0 && sentIds.length === 0) {
    await admin
      .from("channel_connections")
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", connection.id);
    return 0;
  }

  let ingested = 0;
  let maxHistoryId = lastHistoryId ? BigInt(lastHistoryId) : BigInt(0);
  for (const id of inboxIds) {
    const msg = await fetchMessage(accessToken, id);
    if (!msg) continue;
    if (msg.historyId) {
      const h = BigInt(msg.historyId);
      if (h > maxHistoryId) maxHistoryId = h;
    }
    const event = buildInboundEvent(connection, msg);
    if (!event) continue;
    const result = await ingestInboundEvent(admin, event);
    if (result) ingested++;
  }
  for (const id of sentIds) {
    const msg = await fetchMessage(accessToken, id);
    if (!msg) continue;
    const event = buildOutboundEvent(connection, msg);
    if (!event) continue;
    const result = await ingestInboundEvent(admin, event);
    if (result) ingested++;
  }

  const newConfig = { ...cfg, history_id: maxHistoryId.toString() };
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
    // No refresh token — use the existing one and let the call 401 if dead.
    return decrypt(encAccess);
  }

  const refreshToken = decrypt(encRefresh);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID/SECRET missing — cannot refresh");
  }
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
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`refresh failed (${r.status}): ${detail}`);
  }
  const json = (await r.json()) as { access_token?: string; expires_in?: number };
  const fresh = json.access_token;
  if (!fresh) throw new Error("refresh response missing access_token");

  const newSecrets = {
    ...secrets,
    access_token: encrypt(fresh),
    access_token_expires_at: new Date(
      Date.now() + Number(json.expires_in ?? 3600) * 1000,
    ).toISOString(),
  };
  await admin
    .from("channel_connections")
    .update({ secrets: newSecrets })
    .eq("id", connection.id);
  return fresh;
}

async function listMessageIdsViaQuery(
  accessToken: string,
  q: string,
): Promise<string[]> {
  const u = new URL(`${GMAIL_API}/users/me/messages`);
  u.searchParams.set("q", q);
  u.searchParams.set("maxResults", "50");
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`messages.list ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { messages?: { id: string }[] };
  return (j.messages ?? []).map((m) => m.id);
}

interface GmailMessage {
  id: string;
  threadId?: string;
  historyId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPayload;
}

interface GmailPayload {
  headers?: { name: string; value: string }[];
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}

async function fetchMessage(
  accessToken: string,
  id: string,
): Promise<GmailMessage | null> {
  const u = new URL(`${GMAIL_API}/users/me/messages/${id}`);
  u.searchParams.set("format", "full");
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return (await r.json()) as GmailMessage;
}

function buildInboundEvent(
  connection: ChannelConnection,
  msg: GmailMessage,
): InboundEvent | null {
  const headers = msg.payload?.headers ?? [];
  const getH = (name: string): string | undefined =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

  const from = getH("From") ?? "";
  const subject = getH("Subject") ?? "";
  const messageIdHeader = getH("Message-ID") ?? getH("Message-Id");
  const { email, name } = parseAddress(from);
  if (!email) return null;

  // Skip mail we sent ourselves (label SENT, no INBOX).
  const labels = msg.labelIds ?? [];
  if (labels.includes("SENT") && !labels.includes("INBOX")) return null;

  const { text, html } = extractBody(msg.payload);
  const receivedAt = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : new Date().toISOString();

  return {
    channel: "gmail",
    connection,
    externalContactId: email,
    contactName: name || undefined,
    externalMessageId: messageIdHeader || msg.id,
    externalThreadId: msg.threadId,
    subject,
    text: text || stripHtml(html) || "",
    htmlBody: html || undefined,
    receivedAt,
    raw: { gmailId: msg.id, labels },
  };
}

function buildOutboundEvent(
  connection: ChannelConnection,
  msg: GmailMessage,
): InboundEvent | null {
  const headers = msg.payload?.headers ?? [];
  const getH = (name: string): string | undefined =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

  // A sent message is addressed TO the customer — that's who the
  // conversation belongs to. Take the first To recipient.
  const toRaw = getH("To") ?? "";
  const firstTo = toRaw.split(",")[0] ?? "";
  const { email, name } = parseAddress(firstTo);
  if (!email) return null;

  const subject = getH("Subject") ?? "";
  const { text, html } = extractBody(msg.payload);
  return {
    channel: "gmail",
    connection,
    externalContactId: email,
    contactName: name || undefined,
    // Key on the Gmail message id — the send route stores this same id,
    // so a reply sent through the app dedupes against its Sent copy.
    externalMessageId: msg.id,
    externalThreadId: msg.threadId,
    subject,
    text: text || stripHtml(html) || "",
    htmlBody: html || undefined,
    receivedAt: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString(),
    outbound: true,
    raw: { gmailId: msg.id, sent: true },
  };
}

function parseAddress(raw: string): { email: string; name: string } {
  // "John Doe <john@example.com>" or just "john@example.com"
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, ""), email: m[2].toLowerCase() };
  return { name: "", email: raw.trim().toLowerCase() };
}

function extractBody(payload?: GmailPayload): { text: string; html: string } {
  if (!payload) return { text: "", html: "" };
  let text = "";
  let html = "";
  const walk = (p: GmailPayload) => {
    if (p.mimeType === "text/plain" && p.body?.data) {
      text ||= decodeBody(p.body.data);
    } else if (p.mimeType === "text/html" && p.body?.data) {
      html ||= decodeBody(p.body.data);
    }
    for (const part of p.parts ?? []) walk(part);
  };
  walk(payload);
  return { text, html };
}

function decodeBody(data: string): string {
  // Gmail uses URL-safe base64 without padding.
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? padded + "=".repeat(4 - (padded.length % 4)) : padded;
  return Buffer.from(pad, "base64").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
