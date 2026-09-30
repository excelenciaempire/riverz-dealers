import { NextResponse } from 'next/server';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { stripe } from '@/lib/billing/stripe';
import { InvoiceSettlementError, settleSubscriptionInvoice, validInvoiceSettlement } from '@/lib/billing/settle-invoice';
import { getT } from '@/lib/i18n/server';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const blocked = await csrfGuard(request);
  if (blocked) return blocked;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const limit = await limitByKey(`invoice-settle:${gate.actor.userId}`, { limit: 10, windowMs: 60_000 });
  if (!limit.success) return rateLimitResponse(limit);
  const t = await getT();
  const body: unknown = await request.json().catch(() => null);
  if (!validInvoiceSettlement(body)) return NextResponse.json({ error: t('admin.billingSettlementInvalid') }, { status: 400 });
  const db = supabaseAdmin();
  const lock = await db.rpc('claim_billing_admin_lease', { p_workspace: body.workspace_id });
  if (lock.error || !lock.data) return NextResponse.json({ error: t('admin.billingConcurrentChange') }, { status: 409 });
  try {
    const result = await settleSubscriptionInvoice(db, stripe(), body, gate.actor);
    await recordAdminAction(gate.actor, request, { action: 'update.billing_invoice_settlement',
      targetType: 'workspace', targetId: body.workspace_id,
      meta: { invoice_id: body.invoice_id, method: body.method, reason: body.reason.trim(),
        amount: body.amount_remaining, currency: body.currency, ...result },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof InvoiceSettlementError ? error.code : 'unavailable';
    console.error('[billing/settle]', code);
    return NextResponse.json({ error: t(code === 'unavailable' ? 'admin.billingSettlementFailed' : 'admin.billingSettlementChanged') },
      { status: code === 'unavailable' ? 502 : 409 });
  } finally {
    const release = await db.rpc('release_billing_admin_lease', { p_workspace: body.workspace_id, p_lease: lock.data });
    if (release.error) console.error('[billing/settle] lease release failed');
  }
}
