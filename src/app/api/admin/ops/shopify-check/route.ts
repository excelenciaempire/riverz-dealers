import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { csrfGuard } from '@/lib/csrf';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { COLUMNAS_TOKEN, tokenVivo } from '@/lib/shopify/token-vivo';
import { shopifyApiVersion } from '@/lib/shopify/oauth';

export const dynamic = 'force-dynamic';

/** Provider reads only; no credentials, customer data or arbitrary URLs returned. */
export async function POST(request: Request) {
  const csrf = await csrfGuard(request);
  if (csrf) return csrf;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const rate = await limitByKey(`admin:shopify-check:${gate.actor.email}`, { limit: 6, windowMs: 60_000 });
  if (!rate.success) return rateLimitResponse(rate);
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.id)) {
    return NextResponse.json({ error: 'invalid_connection_id' }, { status: 400 });
  }
  const db = supabaseAdmin();
  const { data: row, error } = await db.from('shopify_connections').select(COLUMNAS_TOKEN)
    .eq('id', body.id).eq('platform', 'shopify').maybeSingle();
  if (error) throw new Error('shopify_connection_read_failed');
  if (!row) return NextResponse.json({ error: 'connection_not_found' }, { status: 404 });
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(row.shop_domain)) {
    return NextResponse.json({ error: 'invalid_shop_domain' }, { status: 400 });
  }
  const { accessToken } = await tokenVivo(db, row);
  const base = `https://${row.shop_domain}/admin/api/${shopifyApiVersion()}`;
  const checks = await Promise.all(['/shop.json', '/webhooks.json', '/graphql.json'].map(async path => {
    const response = await fetch(`${base}${path}`, {
      method: path === '/graphql.json' ? 'POST' : 'GET',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: path === '/graphql.json' ? JSON.stringify({ query: '{ shop { id } }' }) : undefined,
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    const payload = await response.json().catch(() => null);
    return { endpoint: path, status: response.status,
      valid: response.ok && (path === '/shop.json' ? !!payload?.shop?.id
        : path === '/webhooks.json' ? Array.isArray(payload?.webhooks) : !!payload?.data?.shop?.id && !payload?.errors?.length) };
  }));
  await recordAdminAction(gate.actor, request, {
    action: 'update.ops_reconciliation', targetType: 'shopify_connections', targetId: row.id,
    meta: { readOnly: true, checks },
  });
  return NextResponse.json({ id: row.id, checks }, { headers: { 'Cache-Control': 'no-store' } });
}
