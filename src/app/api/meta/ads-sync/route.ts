import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/auth/cron";
import { serverError } from "@/lib/api/errors";
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
 * Auth: header `x-cron-secret` matching ADS_SYNC_SECRET (env), vía el
 * helper central timing-safe assertCronAuth — igual que el resto de los
 * crons. (Antes usaba `?secret=` en la query, que quedaba en logs y se
 * comparaba sin constant-time.)
 */
export async function GET(req: Request): Promise<Response> {
  try {
    assertCronAuth(req, "ADS_SYNC_SECRET");
  } catch (r) {
    return r as Response;
  }

  const db = supabaseAdmin();
  const { data: connections, error } = await db
    .from("channel_connections")
    .select("*")
    .in("channel", ["fb_comment", "ig_comment"])
    .eq("status", "connected");

  if (error) {
    return serverError(error);
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
