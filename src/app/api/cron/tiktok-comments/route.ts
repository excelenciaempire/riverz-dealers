import { NextResponse } from "next/server";
import { pollAllTikTokConnections } from "@/lib/channels/tiktok_comment/poll";
import { assertCronAuth } from "@/lib/auth/cron";
import { pingCron } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/tiktok-comments
 *
 * Polls each connected TikTok Business Account's recent videos for new
 * customer comments and ingests them into the unified inbox (idempotent on
 * comment_id). Also keeps the 24h access tokens fresh as a side effect.
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  void pingCron("tiktok-comments");

  try {
    const result = await pollAllTikTokConnections();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
