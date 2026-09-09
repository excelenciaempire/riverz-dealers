import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from '@/lib/db/paginate';
import { mapWithConcurrency } from '@/lib/async/concurrency';
import { decrypt } from '@/lib/whatsapp/encryption';
import { recordPurchases } from '@/lib/contacts/purchases';
import { espejarPedidoDeShopify } from '@/lib/shopify/espejo-de-pedido';
import { TiendanubeClient, normalizeTiendanubeOrder } from './providers/tiendanube';
import { WooCommerceClient, normalizeWooOrder } from './providers/woocommerce';

function emptyTiendanubePage(error: unknown, page: number): unknown[] {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Tiendanube API 404: ')) {
    try {
      const body = JSON.parse(message.slice('Tiendanube API 404: '.length));
      const lastPage = /^Last page is (\d+)$/.exec(body.description ?? '');
      if (body.code === 404 && lastPage && Number(lastPage[1]) < page) return [];
    } catch { /* Other 404s remain real integration errors. */ }
  }
  throw error;
}

/** Passive mirror only: never call ingestOrder, which schedules outbound flows. */
export async function recoverCommerceOrders(db: SupabaseClient) {
  const stores = await selectAll<{
    id: string; workspace_id: string; platform: 'tiendanube' | 'woocommerce';
    shop_domain: string; external_store_id: string; access_token: string; api_secret: string;
    sync_state: { mark?: string; page?: number; page_size?: number; objective?: string; since?: string; attempted_at?: string };
  }>(db, 'shopify_connections', q => q.in('platform', ['tiendanube', 'woocommerce'])
    .in('status', ['active', 'expired', 'error']), { strict: true });
  stores.sort((a, b) => String(a.sync_state?.attempted_at ?? '').localeCompare(String(b.sync_state?.attempted_at ?? '')));
  const deadline = Date.now() + 90_000;
  return mapWithConcurrency(stores, 3, async store => {
    if (Date.now() >= deadline) return { id: store.id, platform: store.platform, recovered: 0, complete: false };
    const state = store.sync_state ?? {};
    const objective = state.objective ?? new Date().toISOString();
    const since = state.since ?? new Date(state.mark ? Date.parse(state.mark) - 15 * 60_000 : Date.now() - 60 * 86_400_000).toISOString();
    const page = state.page ?? 1;
    // Preserve the page width of an interrupted legacy pass to avoid skipping orders.
    const pageSize = state.page_size ?? (page > 1 ? 100 : 25);
    try {
      const token = decrypt(store.access_token);
      const raw = store.platform === 'tiendanube'
        ? await new TiendanubeClient(store.external_store_id, token, store.shop_domain)
          .get<unknown[]>(`/orders?updated_at_min=${encodeURIComponent(since)}&per_page=${pageSize}&page=${page}`)
          .catch(error => emptyTiendanubePage(error, page))
        : await new WooCommerceClient(store.shop_domain, token, decrypt(store.api_secret))
          .get<unknown[]>('/orders', { modified_after: since, per_page: pageSize, page });
      if (!Array.isArray(raw)) throw new Error('invalid_orders_response');
      for (const item of raw) {
        const order = store.platform === 'tiendanube' ? normalizeTiendanubeOrder(item, {}) : normalizeWooOrder(item);
        if (!order) throw new Error('invalid_order');
        const saved = await recordPurchases(db, store.workspace_id, [{
          platform: store.platform, shopDomain: store.shop_domain, externalId: order.externalId,
          placedAt: order.createdAt, total: order.totalPrice, currency: order.currency, orderNumber: order.orderNumber,
          financialStatus: order.state.financialStatus, fulfillmentStatus: order.state.fulfillmentStatus,
          lineItems: order.lineItems, customerEmail: order.customer.email, customerPhone: order.customer.phone,
        }]);
        if (saved !== 1) throw new Error('purchase_mirror_failed');
        await espejarPedidoDeShopify(db, { platform: store.platform, workspaceId: store.workspace_id, shopDomain: store.shop_domain, order: {
          id: order.externalId, name: order.name, order_number: order.orderNumber,
          created_at: order.createdAt, total_price: order.totalPrice, currency: order.currency,
          financial_status: order.state.financialStatus, fulfillment_status: order.state.fulfillmentStatus,
          cancelled_at: order.state.cancelled ? objective : null,
          email: order.customer.email, phone: order.customer.phone,
          customer: { first_name: order.customer.name, email: order.customer.email, phone: order.customer.phone },
          line_items: order.lineItems, order_status_url: order.orderStatusUrl,
        } });
      }
      const complete = raw.length < pageSize;
      const { error } = await db.from('shopify_connections').update({ sync_state: {
        mark: complete ? objective : state.mark, objective: complete ? null : objective,
        since: complete ? null : since, page: complete ? 1 : page + 1,
        page_size: complete ? 25 : pageSize,
        complete, error: null, attempted_at: new Date().toISOString(),
      } }).eq('id', store.id).in('status', ['active', 'expired', 'error']);
      if (error) throw new Error(error.message);
      return { id: store.id, platform: store.platform, recovered: raw.length, complete };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.from('shopify_connections').update({ sync_state: {
        ...state, since, objective, page, page_size: pageSize, complete: false, error: message,
        attempted_at: new Date().toISOString(),
      } }).eq('id', store.id).in('status', ['active', 'expired', 'error']);
      return { id: store.id, platform: store.platform, recovered: 0, complete: false, error: message };
    }
  });
}
