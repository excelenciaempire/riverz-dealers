import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { syncAdPostsForConnection } from "@/lib/channels/meta-ads-sync";
import type { ChannelConnection } from "@/types";

/**
 * GET /api/meta/ads-sync
 *
 * Cron-triggered: walks every connected fb_comment / ig_comment
 * connection and refreshes the post_id → ad_id mapping so the inbox
 * can correctly flag which incoming comments came from ads.
 *
 * Auth: pass `?secret=…` matching ADS_SYNC_SECRET (env). Mirrors the
 * automation-cron pattern already in this repo.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const expected = process.env.ADS_SYNC_SECRET;
  if (expected && url.searchParams.get("secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: connections, error } = await db
    .from("channel_connections")
    .select("*")
    .in("channel", ["fb_comment", "ig_comment"])
    .eq("status", "connected");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let totalInserted = 0;
  let totalUpdated = 0;
  const results: Array<{ id: string; inserted: number; updated: number; error?: string }> = [];

  for (const c of (connections ?? []) as ChannelConnection[]) {
    try {
      const r = await syncAdPostsForConnection(db, c);
      totalInserted += r.inserted;
      totalUpdated += r.updated;
      results.push({ id: c.id, ...r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      results.push({ id: c.id, inserted: 0, updated: 0, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    connections: results.length,
    inserted: totalInserted,
    updated: totalUpdated,
    results,
  });
}
