import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api/errors';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { withCronRun } from "@/lib/cron/heartbeat";
import { runVoiceCampaigns } from '@/lib/voice/campaign';

/** Advances running voice campaigns by one batch each. Every minute. */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  try {
    const res = await runVoiceCampaigns(supabaseAdmin());
    return NextResponse.json(res);
  } catch (err) {
    return serverError(err, 'voice-campaign cron failed');
  }
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("voice-campaign-run", cronHandler);
