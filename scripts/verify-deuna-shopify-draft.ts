/** Controlled draft-only QA. Never completes a draft or contacts a customer. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const workspaceId = '36f81b96-41b9-4d29-b72e-11be3d3070a3';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { tokenVivo } = await import('@/lib/shopify/token-vivo');
  const { data: connection, error } = await db.from('shopify_connections').select('*')
    .eq('workspace_id', workspaceId).eq('shop_domain', 'bs9mqe-na.myshopify.com').eq('status', 'active').single();
  if (error) throw error;
  const { accessToken } = await tokenVivo(db, connection, Number.MAX_SAFE_INTEGER);
  const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
  const scopeResponse = await fetch(`https://${connection.shop_domain}/admin/oauth/access_scopes.json`, { headers });
  if (!scopeResponse.ok) throw new Error(`Scope check: ${scopeResponse.status}`);
  const scopes = await scopeResponse.json() as { access_scopes: Array<{ handle: string }> };
  const handles = scopes.access_scopes.map(s => s.handle);
  if (!handles.includes('write_draft_orders')) throw new Error('Merchant approval for write_draft_orders is still pending. Nothing created.');
  const { error: scopeError } = await db.from('shopify_connections').update({ scope: handles.join(',') })
    .eq('id', connection.id).eq('workspace_id', workspaceId);
  if (scopeError) throw scopeError;
  const base = `https://${connection.shop_domain}/admin/api/2026-04`;
  const created = await fetch(`${base}/draft_orders.json`, {
    method: 'POST', headers, body: JSON.stringify({ draft_order: {
      note: 'RIVERZ QA: borrador técnico sin cliente, sin envío ni cobro. No despachar.',
      tags: 'riverz_qa,no_despachar',
      line_items: [{ title: 'RIVERZ QA - prueba técnica', price: '0.00', quantity: 1, requires_shipping: false, taxable: false }],
      use_customer_default_address: false,
    } }),
  });
  if (!created.ok) throw new Error(`Draft creation: ${created.status}`);
  const { draft_order: draft } = await created.json() as { draft_order: { id: number; status: string } };
  const evidence = { id: draft.id, status: draft.status, webhookReceived: false, deleted: false };
  writeFileSync('tmp/deuna-draft-qa.json', JSON.stringify(evidence, null, 2));
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data, error: readError } = await db.from('shopify_checkouts').select('checkout_id')
        .eq('workspace_id', workspaceId).eq('checkout_id', `draft_${draft.id}`).maybeSingle();
      if (readError) throw readError;
      if (data) { evidence.webhookReceived = true; break; }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } finally {
    const deleted = await fetch(`${base}/draft_orders/${draft.id}.json`, { method: 'DELETE', headers });
    evidence.deleted = deleted.ok;
    writeFileSync('tmp/deuna-draft-qa.json', JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
    if (!deleted.ok) throw new Error(`QA draft ${draft.id} remains: delete returned ${deleted.status}`);
  }
  if (!evidence.webhookReceived) throw new Error('Draft API worked, but webhook arrival was not observed within 30 seconds.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
