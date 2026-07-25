import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api/errors';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { pingCron } from '@/lib/cron/heartbeat';
import { runVoiceCampaigns } from '@/lib/voice/campaign';

/** Advances running voice campaigns by one batch each. Every minute. */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  void pingCron('voice-campaign-run');
  try {
    const res = await runVoiceCampaigns(supabaseAdmin());
    return NextResponse.json(res);
  } catch (err) {
    return serverError(err, 'voice-campaign cron failed');
  }
}
