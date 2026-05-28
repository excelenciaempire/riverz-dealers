import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { startOutlookWatch } from "@/lib/channels/outlook/watch";
import { baseUrl } from "@/lib/channels/oauth";
import type { ChannelConnection } from "@/types";

/**
 * GET /api/cron/outlook-watch
 *
 * (Re)creates the Microsoft Graph push subscription for every connected
 * Outlook mailbox. Graph subscriptions on /messages live at most 3
 * days, so this should fire every ~2 days. Idempotent — an existing
 * subscription is PATCHed to extend its expiry rather than recreated.
 *
 * Auth: `x-cron-secret` must match AUTOMATION_CRON_SECRET (same secret
 * the other crons use).
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  const supplied = request.headers.get("x-cron-secret");
  if (!expected || supplied !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notificationUrl = `${baseUrl(request)}/api/channels/outlook/webhook`;
  const admin = supabaseAdmin();
  const { data: connections, error } = await admin
    .from("channel_connections")
    .select("*")
    .eq("channel", "outlook")
    .eq("status", "connected");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!connections || connections.length === 0) {
    return NextResponse.json({ ok: true, watched: 0 });
  }

  const results: Array<{ id: string; ok: boolean; expiration?: string; error?: string }> = [];
  for (const c of connections as ChannelConnection[]) {
    const r = await startOutlookWatch(admin, c, notificationUrl);
    if (r.error) results.push({ id: c.id, ok: false, error: r.error });
    else results.push({ id: c.id, ok: true, expiration: r.expiration });
  }
  return NextResponse.json({ ok: true, results });
}
