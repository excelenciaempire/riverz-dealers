import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { withCronRun } from '@/lib/cron/heartbeat';
import { installDeunaTrackingEvidence } from '@/lib/tracking/install';

async function handler(request: Request) {
  try { assertCronAuth(request, 'AUTOMATION_CRON_SECRET'); }
  catch (response) { if (response instanceof Response) return response; throw response; }
  return NextResponse.json(await installDeunaTrackingEvidence());
}
export const GET = withCronRun('tracking-evidence-setup', handler);
