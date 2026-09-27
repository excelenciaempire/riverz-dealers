import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { withCronRun } from '@/lib/cron/heartbeat';
import { syncFinancialCosts } from '@/lib/wallet/financial-sync';

async function handler(request: Request) {
  try { assertCronAuth(request, 'AUTOMATION_CRON_SECRET'); }
  catch (error) { if (error instanceof Response) return error; throw error; }
  return Response.json({ ok: true, ...await syncFinancialCosts(supabaseAdmin()) });
}
export const GET = withCronRun('wallet-financial-costs', handler);
export const POST = GET;
export const dynamic = 'force-dynamic';
