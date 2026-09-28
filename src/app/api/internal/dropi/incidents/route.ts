import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  DROPI_BRIDGE_KEY_ID,
  verifyDropiBridgeSignature,
} from '@/lib/logistics/dropi-bridge-auth';
import { installRiverzOfficialDeliveryIncidents } from '@/lib/logistics/incident-install';
import {
  resolveShopifyAdmin,
  setDeliveryIncidentOrderTag,
} from '@/lib/shopify/order-tags';

export const runtime = 'nodejs';

const RIVERZ_OFFICIAL_WORKSPACE_ID = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
const MAX_BODY_BYTES = 16_384;

type DropiIncidentPayload = {
  action?: unknown;
  event_id?: unknown;
  dropi_order_id?: unknown;
  shopify_order_id?: unknown;
  state?: unknown;
  reason?: unknown;
  occurred_at?: unknown;
};

function validSetupPayload(value: DropiIncidentPayload): value is {
  event_id: string;
  action: 'setup';
  occurred_at: string;
} {
  return (
    value.action === 'setup' &&
    typeof value.event_id === 'string' &&
    /^[a-zA-Z0-9:_-]{8,180}$/.test(value.event_id) &&
    typeof value.occurred_at === 'string' &&
    Number.isFinite(Date.parse(value.occurred_at))
  );
}

function validPayload(value: DropiIncidentPayload): value is {
  event_id: string;
  dropi_order_id: number;
  shopify_order_id: string;
  state: 'active' | 'resolved';
  reason: string;
  occurred_at: string;
} {
  const state = value.state;
  const reason = String(value.reason ?? '').trim();
  return (
    typeof value.event_id === 'string' &&
    /^[a-zA-Z0-9:_-]{8,180}$/.test(value.event_id) &&
    Number.isSafeInteger(value.dropi_order_id) &&
    Number(value.dropi_order_id) > 0 &&
    typeof value.shopify_order_id === 'string' &&
    /^\d{6,24}$/.test(value.shopify_order_id) &&
    (state === 'active' || state === 'resolved') &&
    (state === 'resolved' || (reason.length > 0 && reason.length <= 500)) &&
    typeof value.occurred_at === 'string' &&
    Number.isFinite(Date.parse(value.occurred_at))
  );
}

export async function POST(request: Request) {
  const body = await request.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  const verified = verifyDropiBridgeSignature({
    body,
    timestamp: request.headers.get('x-dropi-timestamp'),
    signature: request.headers.get('x-dropi-signature'),
    keyId: request.headers.get('x-dropi-key-id'),
  });
  if (!verified) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: DropiIncidentPayload;
  try {
    payload = JSON.parse(body) as DropiIncidentPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!validPayload(payload)) {
    if (!validSetupPayload(payload)) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
    }
    const setup = await installRiverzOfficialDeliveryIncidents();
    return NextResponse.json({ ok: true, accepted: payload.event_id, setup });
  }

  const shopify = await resolveShopifyAdmin(
    supabaseAdmin(),
    RIVERZ_OFFICIAL_WORKSPACE_ID,
  );
  if (!shopify) {
    return NextResponse.json({ error: 'shopify_unavailable' }, { status: 503 });
  }
  const result = await setDeliveryIncidentOrderTag(
    shopify,
    payload.shopify_order_id,
    payload.state,
    payload.reason,
  );
  if (!result.ok) {
    return NextResponse.json({ error: 'shopify_write_failed' }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    accepted: payload.event_id,
    changed: result.changed,
    key_id: DROPI_BRIDGE_KEY_ID,
  });
}
