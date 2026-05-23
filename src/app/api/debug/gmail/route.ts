import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt } from "@/lib/channels/encryption";
import { ingestInboundEvent } from "@/lib/channels/inbox-writer";
import type { ChannelConnection } from "@/types";
import type { InboundEvent } from "@/lib/channels/types";

/**
 * GET /api/debug/gmail
 *
 * Diagnostic probe for the Gmail polling pipeline. Walks the most
 * recent INBOX message end-to-end (fetch → parse → ingest) and
 * reports what each stage actually saw. Auth: `x-cron-secret`.
 *
 * Temporary — delete once polling is confirmed working.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  const supplied = request.headers.get("x-cron-secret");
  if (!expected || supplied !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: connections, error } = await admin
    .from("channel_connections")
    .select("*")
    .eq("channel", "gmail");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!connections || connections.length === 0) {
    return NextResponse.json({ note: "no gmail connections" });
  }

  const out = [];
  for (const c of connections as ChannelConnection[]) {
    try {
      const accessToken = await getFreshToken(c);
      const list = await fetchJson<{ messages?: { id: string }[]; resultSizeEstimate?: number }>(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:inbox newer_than:1d&maxResults=5",
        accessToken,
      );
      const ids = (list.messages ?? []).map((m) => m.id);

      // Workspace sanity check — the FK to workspaces is the most
      // likely silent failure if the connection's workspace_id is
      // pointing somewhere stale.
      const { data: ws } = await admin
        .from("workspaces")
        .select("id, name")
        .eq("id", c.workspace_id)
        .maybeSingle();

      const perMessage = [];
      for (const id of ids) {
        const msg = await fetchJson<GmailMessage>(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          accessToken,
        );
        const headers = msg.payload?.headers ?? [];
        const get = (n: string) =>
          headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value;
        const fromHeader = get("From") ?? "";
        const subject = get("Subject") ?? "";

        const event: InboundEvent = {
          channel: "gmail",
          connection: c,
          externalContactId: parseEmail(fromHeader),
          contactName: parseName(fromHeader),
          externalMessageId: get("Message-ID") || get("Message-Id") || msg.id,
          externalThreadId: msg.threadId,
          subject,
          text: extractText(msg.payload) || "(no text body)",
          receivedAt: msg.internalDate
            ? new Date(Number(msg.internalDate)).toISOString()
            : new Date().toISOString(),
        };

        let ingestResult: string;
        try {
          const r = await ingestInboundEvent(admin, event);
          ingestResult = r
            ? `OK contact=${r.contact.id.slice(0, 8)} conv=${r.conversation.id.slice(0, 8)} msg=${r.message.id.slice(0, 8)}`
            : "ingest returned null (duplicate or downstream failure)";
        } catch (err) {
          ingestResult = `THROW: ${err instanceof Error ? err.message : String(err)}`;
        }

        perMessage.push({
          gmailId: id,
          from: fromHeader,
          subject,
          parsedEmail: event.externalContactId,
          messageIdHeader: event.externalMessageId,
          textPreview: event.text.slice(0, 80),
          labels: msg.labelIds ?? [],
          ingestResult,
        });
      }

      out.push({
        connectionId: c.id,
        workspaceId: c.workspace_id,
        workspaceExists: Boolean(ws),
        workspaceName: ws?.name ?? null,
        ingestProbeWindow: "in:inbox newer_than:1d",
        candidates: ids.length,
        perMessage,
      });
    } catch (err) {
      out.push({
        connectionId: c.id,
        workspaceId: c.workspace_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ count: out.length, connections: out });
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

async function getFreshToken(connection: ChannelConnection): Promise<string> {
  const secrets = (connection.secrets ?? {}) as Record<string, unknown>;
  const encAccess = String(secrets.access_token ?? "");
  const encRefresh = String(secrets.refresh_token ?? "");
  if (!encAccess) throw new Error("connection missing access_token");

  const expiresAt = secrets.access_token_expires_at
    ? new Date(String(secrets.access_token_expires_at)).getTime()
    : 0;
  if (expiresAt && expiresAt - 60_000 > Date.now()) return decrypt(encAccess);
  if (!encRefresh) return decrypt(encAccess);

  const refreshToken = decrypt(encRefresh);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID/SECRET missing");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!r.ok) throw new Error(`refresh ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("no access_token in refresh response");
  return j.access_token;
}

async function fetchJson<T>(url: string, accessToken: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`${url} ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}

function parseEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}
function parseName(raw: string): string {
  const m = raw.match(/^\s*(.*?)\s*</);
  return m ? m[1].replace(/^"|"$/g, "") : "";
}
function extractText(payload?: GmailMessage["payload"]): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBody(payload.body.data);
  }
  for (const p of payload.parts ?? []) {
    const t = extractText(p);
    if (t) return t;
  }
  return "";
}
function decodeBody(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? padded + "=".repeat(4 - (padded.length % 4)) : padded;
  return Buffer.from(pad, "base64").toString("utf8");
}
