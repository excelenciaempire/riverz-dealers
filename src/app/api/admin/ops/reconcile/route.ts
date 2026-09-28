import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { csrfGuard } from '@/lib/csrf';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';
import { reconcileCapturedShipments } from '@/lib/channels/mercadolibre/shipment-recovery';

export const dynamic = 'force-dynamic';

/** Bounded provider reconciliation, never arbitrary SQL, URLs or message replay. */
export async function POST(request: Request) {
  const csrf = await csrfGuard(request);
  if (csrf) return csrf;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const rate = await limitByKey(`admin:reconcile:${gate.actor.email}`, { limit: 6, windowMs: 60_000 });
  if (!rate.success) return rateLimitResponse(rate);
  const body = await request.json().catch(() => null);
  const apply = body?.apply === true;
  const result = await reconcileCapturedShipments({ apply, limit: 10 });
  await recordAdminAction(gate.actor, request, {
    action: 'update.ops_reconciliation', targetType: 'webhook_events_raw',
    meta: { apply, checked: result.checked, recovered: result.recovered },
  });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
