import { NextResponse } from "next/server";
import { listConnections } from "@/lib/channels/connections";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { startGmailWatch } from "@/lib/channels/gmail/watch";
import { assertCronAuth } from "@/lib/auth/cron";
import type { ChannelConnection } from "@/types";
import {
  DEFAULT_CONNECTION_CONCURRENCY,
  mapWithConcurrency,
} from "@/lib/async/concurrency";
import { withCronRun } from "@/lib/cron/heartbeat";

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
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const admin = supabaseAdmin();
  const connections = await listConnections(admin, {
    channel: "gmail",
    statuses: ["connected"],
  });
  if (connections.length === 0) {
    return NextResponse.json({ ok: true, watched: 0 });
  }

  const results = await mapWithConcurrency(
    connections as ChannelConnection[],
    DEFAULT_CONNECTION_CONCURRENCY,
    async (
      c,
    ): Promise<{
      id: string;
      ok: boolean;
      expiration?: string;
      error?: string;
    }> => {
      const r = await startGmailWatch(admin, c);
      if (r.error) {
        return { id: c.id, ok: false, error: r.error };
      }
      return { id: c.id, ok: true, expiration: r.expiration };
    },
  );
  const failed = results.filter((result) => !result.ok).length;
  return NextResponse.json(
    { ok: failed === 0, failed, results },
    { status: failed ? 207 : 200 },
  );
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("gmail-watch", cronHandler);
