import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
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
  return resolveWorkspaceIdForUser(supabase, user.id);
}

export async function GET() {
  const locale = await getLocale();
  const workspaceId = await workspaceOf();
  if (!workspaceId) {
    return NextResponse.json({ error: translate(locale, 'logistics.unauthorized') }, { status: 401 });
  }
  try {
    const orders = await listOrdersMissingTracking(supabaseAdmin(), workspaceId);
    return NextResponse.json({ orders });
  } catch (err) {
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
  const workspaceId = await workspaceOf();
  if (!workspaceId) {
    return NextResponse.json({ error: translate(locale, 'logistics.unauthorized') }, { status: 401 });
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

  const db = supabaseAdmin();
  try {
    if (body?.dismiss === true) {
      const ok = await dismissMissingTracking(db, workspaceId, orderId);
      return ok
        ? NextResponse.json({ ok: true, message: translate(locale, 'logistics.missingDismissed') })
        : NextResponse.json({ error: translate(locale, 'logistics.missingNotFound') }, { status: 404 });
    }

    const result = await recordManualTracking(db, {
      workspaceId,
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
    console.error('[logistics] manual tracking failed:', err);
    return NextResponse.json({ error: translate(locale, 'logistics.missingError') }, { status: 500 });
  }
}
