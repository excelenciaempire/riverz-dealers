import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { withCronRun } from '@/lib/cron/heartbeat';
import { pollAllZohoConnections } from '@/lib/channels/zoho/poll';

async function cronHandler(request: Request): Promise<Response> {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  const results = await pollAllZohoConnections();
  const failed = results.filter((result) => result.error).length;
  return NextResponse.json(
    {
      total: results.reduce((sum, result) => sum + result.ingested, 0),
      failed,
      results,
    },
    { status: failed ? 207 : 200 }
  );
}

export const GET = withCronRun('zoho-poll', cronHandler);
