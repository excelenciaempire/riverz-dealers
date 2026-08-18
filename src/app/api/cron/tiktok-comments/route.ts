import { NextResponse } from "next/server";
import { pollAllTikTokConnections } from "@/lib/channels/tiktok_comment/poll";
import { ensureTikTokCommentWebhook } from "@/lib/channels/tiktok_comment/webhook-subscribe";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/tiktok-comments
 *
 * Polls each connected TikTok Business Account's recent videos for new
 * customer comments and ingests them into the unified inbox (idempotent on
 * comment_id). Also keeps the 24h access tokens fresh as a side effect.
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  try {
    // El webhook se registra desde acá (TikTok no lo configura en el portal:
    // es una llamada a su API). Va primero y es barato — se saltea solo salvo
    // en el primer arranque o cada 6 h.
    const webhook = await ensureTikTokCommentWebhook();
    const result = await pollAllTikTokConnections();
    return NextResponse.json({ ...result, webhook }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("tiktok-comments", cronHandler);
