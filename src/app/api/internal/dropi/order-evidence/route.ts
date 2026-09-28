import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { verifyDropiBridgeSignature } from '@/lib/logistics/dropi-bridge-auth';
import { dropiEvidenceSchema } from '@/lib/logistics/dropi-order-evidence';
import { DEUNA_DROPI_WORKSPACE } from '@/lib/logistics/dropi-release-policy';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.text();
  if (Buffer.byteLength(body, 'utf8') > 16_384)
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  if (!verifyDropiBridgeSignature({ body,
    timestamp: request.headers.get('x-dropi-timestamp'),
    signature: request.headers.get('x-dropi-signature'),
    keyId: request.headers.get('x-dropi-key-id'),
  })) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  let input: unknown;
  try { input = JSON.parse(body); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = dropiEvidenceSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_evidence' }, { status: 400 });
  const { evidence, observed_at, shopify_order_id } = parsed.data;
  // Binding verified against both connected Shopify and authenticated Dropi.
  // A signed payload cannot select another tenant, account, or store.
  if (evidence.account_id !== '455408' || evidence.shop_id !== '404013')
    return NextResponse.json({ error: 'store_mismatch' }, { status: 403 });
  const observed = Date.parse(observed_at);
  const historyObserved = Date.parse(evidence.buyer_history.observed_at);
  const now = Date.now();
  if (observed > now + 60_000 || observed < now - 15 * 60_000 ||
      historyObserved > observed || historyObserved < observed - 15 * 60_000)
    return NextResponse.json({ error: 'stale_evidence' }, { status: 409 });
  const { data, error } = await supabaseAdmin().rpc('record_dropi_order_evidence', {
    p_workspace_id: DEUNA_DROPI_WORKSPACE,
    p_shop_domain: 'bs9mqe-na.myshopify.com', p_shopify_order_id: shopify_order_id,
    p_observed_at: observed_at, p_evidence: evidence,
  });
  if (error) return NextResponse.json({ error: 'evidence_conflict_or_storage_failure' }, { status: 409 });
  if (data === 'order_not_mirrored')
    return NextResponse.json({ error: 'order_not_mirrored' }, { status: 409 });
  if (data !== 'updated' && data !== 'stale_or_duplicate')
    return NextResponse.json({ error: 'unexpected_storage_response' }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}
