import { NextResponse } from "next/server";
import { pollAllOutlookConnections } from "@/lib/channels/outlook/poll";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/outlook-poll
 *
 * Mirror of /api/cron/gmail-poll — polls every connected Outlook /
 * Hotmail mailbox via Microsoft Graph and ingests new inbox messages.
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 *
 * Intended to be hit by GitHub Actions every 5 minutes.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  try {
    const results = await pollAllOutlookConnections();
    const total = results.reduce((n, r) => n + r.ingested, 0);
    // Surface partial failures via 207 so Render flips red on breakage.
    const failed = results.filter(
      (r) => (r as { error?: unknown }).error,
    ).length;
    const status = failed > 0 ? 207 : 200;
    return NextResponse.json({ total, failed, results }, { status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("outlook-poll", cronHandler);
