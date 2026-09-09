/** One-off passive recovery using the same production synchronizers.
 * node --conditions=react-server --env-file=.env.local --import tsx scripts/recover-integration-inbox.ts --channels-only
 * Omit --channels-only after applying migration 255 to include stores.
 */
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../src/lib/channels/admin-client';
import { pullCommentsAll } from '../src/lib/channels/comment-pull';
import { sincronizarPedidosDeShopify } from '../src/lib/shopify/sincronizar-pedidos';
import { recoverCommerceOrders } from '../src/lib/commerce/recover-orders';

async function main() {
  // This process imports handlers directly; it never starts a scheduler/server.
  process.env.AUTOMATION_CRON_SECRET ||= randomUUID();
  const db = supabaseAdmin();
  const channelsOnly = process.argv.includes('--channels-only');
  if (!channelsOnly) {
    const { error } = await db.from('shopify_connections').select('sync_state').limit(0);
    if (error) throw new Error('Apply migration 255 before store recovery.');
  }
  const { GET } = await import('../src/app/api/cron/meta-dm-backfill/route');
  const response = await GET(new Request('http://localhost/api/cron/meta-dm-backfill', {
    headers: { 'x-cron-secret': process.env.AUTOMATION_CRON_SECRET },
  }));
  console.log(JSON.stringify({ phase: 'meta-dm', http: response.status, result: await response.json() }));
  console.log(JSON.stringify({ phase: 'comments', result: await pullCommentsAll(db) }));
  if (!channelsOnly) {
    console.log(JSON.stringify({ phase: 'shopify', result: await sincronizarPedidosDeShopify(db) }));
    console.log(JSON.stringify({ phase: 'commerce', result: await recoverCommerceOrders(db) }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
