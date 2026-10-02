import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { logisticsAccess, LogisticsAccessError } from '@/lib/logistics/access';
import { assertWorkspaceWritable, BillingReadOnlyError } from '@/lib/billing/read-only';
import {
  dismissMissingTracking,
  listOrdersMissingTracking,
  recordManualTracking,
  type RecordTrackingResult,
} from '@/lib/logistics/missing-tracking';

/**
 * Pedidos sin guía.
 *
 *   GET  — los pedidos que deberían tener guía y en Shopify no la tienen.
 *   POST — { orderId, trackingNumber, carrier } guarda la guía y avisa al
 *          cliente; { orderId, dismiss: true } marca que no se despacha.
 */

async function workspaceOf() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  return workspaceId ? { workspaceId, actorId: user.id } : null;
}

export async function GET() {
  const locale = await getLocale();
  const context = await workspaceOf();
  if (!context) {
    return NextResponse.json({ error: translate(locale, 'logistics.unauthorized') }, { status: 401 });
  }
  const { workspaceId, actorId } = context;
  try {
    const db = supabaseAdmin();
    await logisticsAccess(db, workspaceId, actorId);
    const orders = await listOrdersMissingTracking(db, workspaceId);
    await logisticsAccess(db, workspaceId, actorId);
    return NextResponse.json({ orders }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof LogisticsAccessError) return NextResponse.json({ error: translate(locale, 'logistics.forbidden') }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    console.error('[logistics] missing tracking list failed:', err);
    return NextResponse.json({ error: translate(locale, 'logistics.missingLoadError') }, { status: 500 });
  }
}

const MESSAGE: Record<RecordTrackingResult, { key: string; status: number }> = {
  sent: { key: 'missingSent', status: 200 },
  saved_without_contact: { key: 'missingSavedNoContact', status: 200 },
  already_recorded: { key: 'missingAlreadyRecorded', status: 200 },
  already_tracked: { key: 'missingAlreadyTracked', status: 409 },
  cancelled: { key: 'missingCancelled', status: 409 },
  not_found: { key: 'missingNotFound', status: 404 },
  store_unavailable: { key: 'missingStoreUnavailable', status: 502 },
  invalid: { key: 'missingInvalid', status: 400 },
};

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const context = await workspaceOf();
  if (!context) {
    return NextResponse.json({ error: translate(locale, 'logistics.unauthorized') }, { status: 401 });
  }
  const { workspaceId, actorId } = context;

  const db = supabaseAdmin();
  try {
    await logisticsAccess(db, workspaceId, actorId, true);
    await assertWorkspaceWritable(db, workspaceId);
  } catch (err) {
    const key = err instanceof BillingReadOnlyError ? 'readOnly' : err instanceof LogisticsAccessError ? 'forbidden' : 'missingError';
    return NextResponse.json({ error: translate(locale, `logistics.${key}`) }, { status: err instanceof BillingReadOnlyError ? 402 : err instanceof LogisticsAccessError ? 403 : 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    orderId?: unknown;
    trackingNumber?: unknown;
    carrier?: unknown;
    dismiss?: unknown;
  } | null;
  const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    return NextResponse.json({ error: translate(locale, 'logistics.missingNotFound') }, { status: 404 });
  }

  try {
    if (body?.dismiss === true) {
      const ok = await dismissMissingTracking(db, workspaceId, orderId, actorId);
      return ok
        ? NextResponse.json({ ok: true, message: translate(locale, 'logistics.missingDismissed') })
        : NextResponse.json({ error: translate(locale, 'logistics.missingNotFound') }, { status: 404 });
    }

    const result = await recordManualTracking(db, {
      workspaceId,
      actorId,
      orderId,
      trackingNumber: body?.trackingNumber,
      carrier: body?.carrier,
    });
    const { key, status } = MESSAGE[result];
    const message = translate(locale, `logistics.${key}`);
    return status === 200
      ? NextResponse.json({ ok: true, result, message })
      : NextResponse.json({ error: message, result }, { status });
  } catch (err) {
    if (err instanceof LogisticsAccessError || err instanceof BillingReadOnlyError) return NextResponse.json({ error: translate(locale, `logistics.${err instanceof BillingReadOnlyError ? 'readOnly' : 'forbidden'}`) }, { status: err instanceof BillingReadOnlyError ? 402 : 403 });
    console.error('[logistics] manual tracking failed:', err);
    return NextResponse.json({ error: translate(locale, 'logistics.missingError') }, { status: 500 });
  }
}
