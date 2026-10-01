import { assertCronAuthAny } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { withCronRun } from '@/lib/cron/heartbeat';
import { deliverPostPurchaseGuides } from '@/lib/shopify/post-purchase-guide-delivery';

async function handler(request: Request) {
  try {
    assertCronAuthAny(request, ['AUTOMATION_CRON_SECRET', 'CRON_SECRET']);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  const result = await deliverPostPurchaseGuides(supabaseAdmin());
  return Response.json(result, {
    status: result.errors || result.failed || result.uncertain ? 207 : 200,
  });
}
export const GET = withCronRun('post-purchase-guides', handler);
