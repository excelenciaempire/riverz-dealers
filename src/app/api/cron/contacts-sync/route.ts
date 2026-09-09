import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { syncAllWorkspaces } from '@/lib/contacts/bulk-sync';
import { sincronizarPedidosDeShopify } from '@/lib/shopify/sincronizar-pedidos';
import { recoverCommerceOrders } from '@/lib/commerce/recover-orders';
import { assertCronAuth } from '@/lib/auth/cron';
import { withCronRun } from "@/lib/cron/heartbeat";

/**
 * GET /api/cron/contacts-sync
 *
 * Completa y reclasifica la ficha de los contactos: dirección, pedidos y
 * gasto desde Shopify, y de ahí las etiquetas (comprador,
 * comprador-recurrente, oferta, unidades).
 *
 * Trae la lista de clientes de la tienda de una sola vez y empareja en
 * memoria, así que una corrida cubre hasta 800 contactos en segundos en vez
 * de las decenas que permitía preguntar de a uno. Prioriza los que nunca se
 * sincronizaron —los nuevos— y después rota por los más viejos.
 *
 * `pending` dice cuántos faltan: en 0, la base está al día.
 *
 * Auth: `x-cron-secret` header must match `AUTOMATION_CRON_SECRET`.
 */
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  try {
    const [results, orders, commerce] = await Promise.all([
      syncAllWorkspaces(supabaseAdmin()),
      sincronizarPedidosDeShopify(supabaseAdmin()),
      recoverCommerceOrders(supabaseAdmin()),
    ]);
    const totals = results.reduce(
      (acc, r) => ({
        processed: acc.processed + r.processed,
        matched: acc.matched + r.matched,
        unmatched: acc.unmatched + r.unmatched,
        pending: acc.pending + r.pending,
      }),
      { processed: 0, matched: 0, unmatched: 0, pending: 0 },
    );
    const ok = orders.every(order => !order.error) && commerce.every(order => !order.error);
    return NextResponse.json({ ok, ...totals, workspaces: results, orders, commerce }, { status: ok ? 200 : 207 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("contacts-sync", cronHandler);
