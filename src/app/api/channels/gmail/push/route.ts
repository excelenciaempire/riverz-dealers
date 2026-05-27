import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { ingestInboundEvent } from "@/lib/channels/inbox-writer";
import { getFreshAccessToken } from "@/lib/channels/gmail/watch";
import type { ChannelConnection } from "@/types";
import type { InboundEvent } from "@/lib/channels/types";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

/**
 * POST /api/channels/gmail/push?secret=...
 *
 * Receives Google Cloud Pub/Sub push notifications for Gmail mailbox
 * changes. Payload shape:
 *   { message: { data: "<base64 of {emailAddress, historyId}>" } }
 *
 * Auth: query-param `secret` must match GMAIL_PUSH_SECRET. We use a
 * query secret instead of OIDC because the Pub/Sub push subscription
 * UI takes a URL — simpler to verify here than to wire JWT verify.
 *
 * Behaviour: look up the connection by emailAddress, call
 * `history.list` from the stored historyId, fetch each new message,
 * push it through ingestInboundEvent.
 *
 * Always returns 200 (or 401 on auth) — Pub/Sub will retry on any
 * non-2xx response, which would amplify any downstream failure into a
 * thundering herd. Per-message errors are logged and dropped.
 */
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const expected = process.env.GMAIL_PUSH_SECRET;
  if (!expected || url.searchParams.get("secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { message?: { data?: string } }
    | null;
  const data = body?.message?.data;
  if (!data) {
    // Pub/Sub sends an empty body for some lifecycle events — ack 200
    // so we don't get retried into oblivion.
    return NextResponse.json({ ok: true, note: "no message data" });
  }

  let decoded: { emailAddress?: string; historyId?: string };
  try {
    decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return NextResponse.json({ ok: true, note: "bad payload" });
  }
  const { emailAddress, historyId } = decoded;
  if (!emailAddress || !historyId) {
    return NextResponse.json({ ok: true, note: "missing fields" });
  }

  const admin = supabaseAdmin();
  const { data: rows } = await admin
    .from("channel_connections")
    .select("*")
    .eq("channel", "gmail")
    .eq("status", "connected");
  if (!rows) {
    return NextResponse.json({ ok: true, ingested: 0 });
  }

  // Match the mailbox to a connection. We compare against config.email
  // (set by the OAuth callback) and external_account_id as fallback.
  const connection = (rows as ChannelConnection[]).find((c) => {
    const cfg = (c.config ?? {}) as Record<string, unknown>;
    return (
      String(cfg.email ?? "").toLowerCase() === emailAddress.toLowerCase() ||
      String(c.external_account_id ?? "").toLowerCase() === emailAddress.toLowerCase()
    );
  });
  if (!connection) {
    return NextResponse.json({ ok: true, note: "no matching connection" });
  }

  try {
    const ingested = await processHistory(admin, connection, historyId);
    return NextResponse.json({ ok: true, ingested });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[gmail/push]", msg);
    // Still 200 — see comment above.
    return NextResponse.json({ ok: true, error: msg });
  }
}

async function processHistory(
  admin: ReturnType<typeof supabaseAdmin>,
  connection: ChannelConnection,
  newHistoryId: string,
): Promise<number> {
  const accessToken = await getFreshAccessToken(admin, connection);
  if (!accessToken) throw new Error("no access token");

  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  const startHistoryId = cfg.history_id ? String(cfg.history_id) : "";
  if (!startHistoryId) {
    // No baseline — fall back to listing the inbox and let dedupe
    // handle overlap. Saves us a special-case at watch-init time.
    return ingestRecentInbox(admin, connection, accessToken, newHistoryId);
  }

  // history.list pages on Gmail. 5 pages cap matches the poller.
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const u = new URL(`${GMAIL_API}/users/me/history`);
    u.searchParams.set("startHistoryId", startHistoryId);
    u.searchParams.set("historyTypes", "messageAdded");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const r = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (r.status === 404) {
      // startHistoryId too old — recover by listing recent inbox.
      return ingestRecentInbox(admin, connection, accessToken, newHistoryId);
    }
    if (!r.ok) throw new Error(`history.list ${r.status}`);
    const j = (await r.json()) as {
      history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
      nextPageToken?: string;
    };
    for (const h of j.history ?? []) {
      for (const m of h.messagesAdded ?? []) {
        // Only ingest mail that landed in INBOX. Drafts and sent
        // copies show up as messageAdded too.
        if (m.message.labelIds?.includes("INBOX")) {
          ids.add(m.message.id);
        }
      }
    }
    pageToken = j.nextPageToken;
    pages++;
  } while (pageToken && pages < 5);

  let ingested = 0;
  for (const id of ids) {
    const event = await fetchAndBuild(accessToken, connection, id);
    if (!event) continue;
    const r = await ingestInboundEvent(admin, event);
    if (r) ingested++;
  }

  await admin
    .from("channel_connections")
    .update({
      config: { ...cfg, history_id: newHistoryId },
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
  return ingested;
}

async function ingestRecentInbox(
  admin: ReturnType<typeof supabaseAdmin>,
  connection: ChannelConnection,
  accessToken: string,
  newHistoryId: string,
): Promise<number> {
  const u = new URL(`${GMAIL_API}/users/me/messages`);
  u.searchParams.set("q", "in:inbox newer_than:1d");
  u.searchParams.set("maxResults", "25");
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`messages.list ${r.status}`);
  const j = (await r.json()) as { messages?: { id: string }[] };
  let ingested = 0;
  for (const m of j.messages ?? []) {
    const event = await fetchAndBuild(accessToken, connection, m.id);
    if (!event) continue;
    const result = await ingestInboundEvent(admin, event);
    if (result) ingested++;
  }
  const cfg = (connection.config ?? {}) as Record<string, unknown>;
  await admin
    .from("channel_connections")
    .update({
      config: { ...cfg, history_id: newHistoryId },
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
  return ingested;
}

interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: {
    headers?: { name: string; value: string }[];
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailMessage["payload"][];
  };
}

async function fetchAndBuild(
  accessToken: string,
  connection: ChannelConnection,
  id: string,
): Promise<InboundEvent | null> {
  const r = await fetch(`${GMAIL_API}/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const msg = (await r.json()) as GmailMessage;
  const headers = msg.payload?.headers ?? [];
  const get = (n: string) =>
    headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value;

  const fromHeader = get("From") ?? "";
  const subject = get("Subject") ?? "";
  const messageIdHeader = get("Message-ID") || get("Message-Id");
  const fromEmail = parseEmail(fromHeader);
  if (!fromEmail) return null;
  if ((msg.labelIds ?? []).includes("SENT") && !(msg.labelIds ?? []).includes("INBOX")) {
    return null;
  }
  const { text, html } = extractBody(msg.payload);
  return {
    channel: "gmail",
    connection,
    externalContactId: fromEmail,
    contactName: parseName(fromHeader),
    externalMessageId: messageIdHeader || msg.id,
    externalThreadId: msg.threadId,
    subject,
    text: text || stripHtml(html) || "",
    htmlBody: html || undefined,
    receivedAt: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString(),
  };
}

function parseEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}
function parseName(raw: string): string {
  const m = raw.match(/^\s*(.*?)\s*</);
  return m ? m[1].replace(/^"|"$/g, "") : "";
}
function extractBody(payload?: GmailMessage["payload"]): { text: string; html: string } {
  if (!payload) return { text: "", html: "" };
  let text = "";
  let html = "";
  const walk = (p: NonNullable<GmailMessage["payload"]>) => {
    if (p.mimeType === "text/plain" && p.body?.data) text ||= decode(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data) html ||= decode(p.body.data);
    for (const part of p.parts ?? []) if (part) walk(part);
  };
  walk(payload);
  return { text, html };
}
function decode(b: string): string {
  const p = b.replace(/-/g, "+").replace(/_/g, "/");
  const pad = p.length % 4 ? p + "=".repeat(4 - (p.length % 4)) : p;
  return Buffer.from(pad, "base64").toString("utf8");
}
function stripHtml(h: string): string {
  return h
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
