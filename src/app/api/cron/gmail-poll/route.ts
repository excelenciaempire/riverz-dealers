import { NextResponse } from "next/server";
import { pollAllGmailConnections } from "@/lib/channels/gmail/poll";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/gmail-poll
 *
 * Polls every connected Gmail mailbox for new inbox messages and
 * ingests them into the unified inbox. Auth: `x-cron-secret` header
 * must match `AUTOMATION_CRON_SECRET` (same shared secret the other
 * cron endpoints use — saves provisioning a new env var).
 *
 * Intended to be hit by Render Cron every 2-5 minutes.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  try {
    const results = await pollAllGmailConnections();
    const total = results.reduce((n, r) => n + r.ingested, 0);
    // Surface partial failures (token revoked, Graph 5xx) via HTTP 207
    // so Render's cron monitor flips red on per-connection breakage.
    // Without this, a workspace whose Gmail token has been revoked goes
    // silent and the cron looks green forever.
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
export const GET = withCronRun("gmail-poll", cronHandler);
