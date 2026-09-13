import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { withCronRun } from '@/lib/cron/heartbeat';
import { reconcileNumbers } from '@/lib/voice/number-billing';
async function handler(request: Request) {
  try { assertCronAuth(request, 'AUTOMATION_CRON_SECRET'); }
  catch (r) { if (r instanceof Response) return r; throw r; }
  const result = await reconcileNumbers(supabaseAdmin());
  return NextResponse.json(result, { status: result.failures.length ? 207 : 200 });
}
export const GET = withCronRun('voice-numbers', handler);
export const POST = GET;
export const dynamic = 'force-dynamic';
