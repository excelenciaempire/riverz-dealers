import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { decrypt, encrypt } from "@/lib/channels/encryption";
import type { ChannelConnection } from "@/types";

/**
 * GET /api/debug/gmail
 *
 * Returns diagnostic info about the connected Gmail mailbox — email,
 * total messages, last 5 inbox subjects. Auth: `x-cron-secret`.
 *
 * This is a temporary probe; remove once polling is confirmed working.
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
      const profile = await fetchJson(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        accessToken,
      );
      const listInbox = await fetchJson(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:inbox&maxResults=5",
        accessToken,
      );
      const listAll = await fetchJson(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5",
        accessToken,
      );
      const subjects: string[] = [];
      for (const m of (listInbox.messages ?? []).slice(0, 5)) {
        const detail = await fetchJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          accessToken,
        );
        const headers = detail?.payload?.headers ?? [];
        const get = (n: string) =>
          headers.find((h: { name: string; value: string }) => h.name.toLowerCase() === n)
            ?.value;
        subjects.push(`${get("date") ?? ""} | ${get("from") ?? ""} | ${get("subject") ?? ""}`);
      }
      out.push({
        connectionId: c.id,
        status: c.status,
        labelInDb: c.label,
        externalIdInDb: c.external_account_id,
        configInDb: c.config,
        profile: {
          emailAddress: profile?.emailAddress,
          messagesTotal: profile?.messagesTotal,
          threadsTotal: profile?.threadsTotal,
          historyId: profile?.historyId,
        },
        inboxCountSample: (listInbox.messages ?? []).length,
        inboxResultSizeEstimate: listInbox.resultSizeEstimate,
        allCountSample: (listAll.messages ?? []).length,
        allResultSizeEstimate: listAll.resultSizeEstimate,
        recentInbox: subjects,
      });
    } catch (err) {
      out.push({
        connectionId: c.id,
        status: c.status,
        labelInDb: c.label,
        externalIdInDb: c.external_account_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ count: out.length, connections: out });
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
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("no access_token in refresh response");
  // Persist fresh token for next time
  void encrypt; // referenced for symmetry; we keep refresh updates out of debug
  return j.access_token;
}

async function fetchJson(url: string, accessToken: string): Promise<Record<string, unknown> & { messages?: Array<{ id: string }>; payload?: { headers?: Array<{ name: string; value: string }> }; resultSizeEstimate?: number; emailAddress?: string; messagesTotal?: number; threadsTotal?: number; historyId?: string }> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`${url} ${r.status}: ${await r.text()}`);
  return r.json();
}
