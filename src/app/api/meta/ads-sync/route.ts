import { NextResponse } from "next/server";
import { listConnections } from "@/lib/channels/connections";
import { assertCronAuthAny } from "@/lib/auth/cron";
import { serverError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { syncAdPostsForConnection } from "@/lib/channels/meta-ads-sync";
import { withCronRun } from "@/lib/cron/heartbeat";
import type { ChannelConnection } from "@/types";

/**
 * GET /api/meta/ads-sync
 *
 * Cron-triggered: walks every connected fb_comment / ig_comment
 * connection and refreshes the post_id → ad_id mapping so the inbox
 * can correctly flag which incoming comments came from ads.
 *
 * Auth: header `x-cron-secret`. Acepta ADS_SYNC_SECRET (el que manda el
 * workflow de GitHub) o AUTOMATION_CRON_SECRET (el que manda el reloj interno);
 * los dos son secretos del mismo dueño, así que aceptar cualquiera no debilita
 * nada y evita el 401 mudo que dejaría el trabajo sin correr para siempre.
 */
async function handler(req: Request): Promise<Response> {
  try {
    assertCronAuthAny(req, ["ADS_SYNC_SECRET", "AUTOMATION_CRON_SECRET"]);
  } catch (r) {
    return r as Response;
  }

  const db = supabaseAdmin();
  const connections = await listConnections(db, {
    channels: ["fb_comment", "ig_comment"],
    statuses: ["connected"],
  });

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

/** Registra la corrida en `cron_runs` como el resto de los trabajos: hasta
 *  ahora este no dejaba rastro y su silencio era indistinguible de no correr. */
export const GET = withCronRun("ads-sync", handler);
