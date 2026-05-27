import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { startGmailWatch } from "@/lib/channels/gmail/watch";
import type { ChannelConnection } from "@/types";

/**
 * GET /api/cron/gmail-watch
 *
 * Calls Gmail's `users.watch` for every connected mailbox so Cloud
 * Pub/Sub starts pushing change notifications. Gmail stops sending
 * pushes 7 days after the last watch call, so this cron should fire
 * every 6 days or so. Calling it more often is harmless — the
 * endpoint is idempotent and just refreshes the expiration window.
 *
 * Auth: `x-cron-secret` matches AUTOMATION_CRON_SECRET (same one Gmail
 * polling uses — saves provisioning another secret).
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
    .eq("channel", "gmail")
    .eq("status", "connected");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!connections || connections.length === 0) {
    return NextResponse.json({ ok: true, watched: 0 });
  }

  const results: Array<{ id: string; ok: boolean; expiration?: string; error?: string }> = [];
  for (const c of connections as ChannelConnection[]) {
    const r = await startGmailWatch(admin, c);
    if (r.error) {
      results.push({ id: c.id, ok: false, error: r.error });
    } else {
      results.push({ id: c.id, ok: true, expiration: r.expiration });
    }
  }
  return NextResponse.json({ ok: true, results });
}
