import { NextResponse } from "next/server";
import { sellarEntregaPorPush } from "@/lib/channels/connections";
import { safeSecretEqual } from "@/lib/auth/cron";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { listConnections } from "@/lib/channels/connections";
import { savePollState } from "@/lib/channels/poll-state";
import { getFreshAccessToken } from "@/lib/channels/gmail/watch";
import { ingestGmailMessage } from "@/lib/channels/gmail/poll";
import { pedirAlProveedor } from "@/lib/channels/email/falla-transitoria";
import type { ChannelConnection } from "@/types";

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
 * push it through the same ingest path the poller uses
 * (`ingestGmailMessage`: same attachments, same skip of what is already
 * stored).
 *
 * Always returns 200 (or 401 on auth) — Pub/Sub will retry on any
 * non-2xx response, which would amplify any downstream failure into a
 * thundering herd. A failed delivery keeps the old history_id, so the next
 * notification (and the poller) pick the same messages up again.
 */
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const expected = process.env.GMAIL_PUSH_SECRET;
  // Comparación timing-safe (Pub/Sub solo permite el secret en la query,
  // no headers custom, así que el secret sigue en `?secret=`).
  if (!safeSecretEqual(url.searchParams.get("secret"), expected)) {
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
  const rows = await listConnections(admin, { channel: "gmail" });

  // Match the mailbox to EVERY connection that holds it (the same mailbox
  // may live in more than one workspace — each gets its own delivery). We
  // compare against config.email (set by the OAuth callback) and
  // external_account_id as fallback.
  const connections = rows.filter((c) => {
    const cfg = (c.config ?? {}) as Record<string, unknown>;
    return (
      String(cfg.email ?? "").toLowerCase() === emailAddress.toLowerCase() ||
      String(c.external_account_id ?? "").toLowerCase() === emailAddress.toLowerCase()
    );
  });
  if (connections.length === 0) {
    return NextResponse.json({ ok: true, note: "no matching connection" });
  }

  let ingested = 0;
  let lastError: string | null = null;
  for (const connection of connections) {
    try {
      sellarEntregaPorPush(admin, connection.id);
      ingested += await processHistory(admin, connection, historyId);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error("[gmail/push]", lastError);
      // Keep going — one workspace's failure must not starve the other.
    }
  }
  // Still 200 — see comment above.
  return NextResponse.json(
    lastError ? { ok: true, ingested, error: lastError } : { ok: true, ingested },
  );
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
    const r = await pedirAlProveedor(
      u,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "history.list",
    );
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
        // copies show up as messageAdded too (el poll trae los enviados).
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
    const r = await ingestGmailMessage(admin, connection, accessToken, id, {
      enVivo: true,
    });
    if (r.ingested) ingested++;
  }

  await guardarHistoryId(admin, connection, newHistoryId);
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
  const r = await pedirAlProveedor(
    u,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "messages.list",
  );
  if (!r.ok) throw new Error(`messages.list ${r.status}`);
  const j = (await r.json()) as { messages?: { id: string }[] };
  let ingested = 0;
  for (const m of j.messages ?? []) {
    const result = await ingestGmailMessage(admin, connection, accessToken, m.id, {
      enVivo: true,
    });
    if (result.ingested) ingested++;
  }
  await guardarHistoryId(admin, connection, newHistoryId);
  return ingested;
}

/**
 * Sólo el cursor del push, mezclado contra la fila ACTUAL. Antes se escribía
 * `{ ...config de la foto, history_id }` más `last_synced_at`: la foto pisaba
 * el progreso que el poll guardó mientras tanto (el historial volvía a
 * empezar) y `last_synced_at` encogía la primera lectura del poll a un día.
 * `last_synced_at` es del poll; la señal de que el push llega es
 * `last_push_at` (`sellarEntregaPorPush`).
 */
async function guardarHistoryId(
  admin: ReturnType<typeof supabaseAdmin>,
  connection: ChannelConnection,
  historyId: string,
): Promise<void> {
  await savePollState(admin, connection.id, { history_id: historyId }, null, {
    complete: false,
  });
}
