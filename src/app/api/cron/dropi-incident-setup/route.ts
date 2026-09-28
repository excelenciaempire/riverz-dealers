import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { withCronRun } from '@/lib/cron/heartbeat';
import { installRiverzOfficialDeliveryIncidents } from '@/lib/logistics/incident-install';

async function handler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (response) {
    if (response instanceof Response) return response;
    throw response;
  }
  return NextResponse.json(await installRiverzOfficialDeliveryIncidents());
}

export const GET = withCronRun('dropi-incident-setup', handler);
