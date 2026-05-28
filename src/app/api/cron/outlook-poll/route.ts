import { NextResponse } from "next/server";
import { pollAllOutlookConnections } from "@/lib/channels/outlook/poll";

/**
 * GET /api/cron/outlook-poll
 *
 * Mirror of /api/cron/gmail-poll — polls every connected Outlook /
 * Hotmail mailbox via Microsoft Graph and ingests new inbox messages.
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 *
 * Intended to be hit by GitHub Actions every 5 minutes.
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
    const results = await pollAllOutlookConnections();
    const total = results.reduce((n, r) => n + r.ingested, 0);
    return NextResponse.json({ total, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
