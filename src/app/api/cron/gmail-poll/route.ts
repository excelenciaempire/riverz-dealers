import { NextResponse } from "next/server";
import { pollAllGmailConnections } from "@/lib/channels/gmail/poll";

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
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-cron-secret");
  if (supplied !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await pollAllGmailConnections();
    const total = results.reduce((n, r) => n + r.ingested, 0);
    return NextResponse.json({ total, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
