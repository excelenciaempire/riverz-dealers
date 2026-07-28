import { NextResponse } from "next/server";
import { pollAllMercadoLibreConnections } from "@/lib/channels/mercadolibre/poll";
import { assertCronAuth } from "@/lib/auth/cron";
import { withCronRun } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/mercadolibre-poll
 *
 * Reconciliation backstop: pulls each connected MercadoLibre seller's
 * UNANSWERED questions and ingests them (ML notifications carry no body and
 * are lost if the token was momentarily dead). Auth: `x-cron-secret` header
 * must match `AUTOMATION_CRON_SECRET`.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, "AUTOMATION_CRON_SECRET");
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  try {
    const result = await pollAllMercadoLibreConnections();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("mercadolibre-poll", cronHandler);
