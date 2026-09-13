import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags';
import { nextPageInfo } from '@/lib/shopify/admin-client';
import { confirmationSummary } from '@/lib/shopify/confirmation-summary';
import { resolveCarrierTrackingUrl } from '@/lib/shopify/carrier-tracking';
import { confirmationDisplayVars } from '@/lib/automations/confirmation-copy';
import { planLogisticsDraft, type LogisticsSnapshot } from '@/lib/automations/logistics-draft';
import type { Locale } from '@/lib/i18n/config';

interface ShopifyOrder {
  id: number; name: string; created_at: string; updated_at: string;
  cancelled_at: string | null; total_price: string; currency: string;
  fulfillment_status: string | null; shipping_address?: Record<string, unknown>;
  phone?: string; line_items: Array<Record<string, unknown>>;
  fulfillments?: Array<{ status: string; shipment_status: string | null;
    tracking_number: string | null; tracking_company: string | null; tracking_url: string | null }>;
}
export function shopifyLogisticsSnapshot(order: ShopifyOrder, workspaceId: string, now: number): LogisticsSnapshot {
  const activeFulfillments = order.fulfillments?.filter(f => f.status !== 'cancelled') ?? [];
  const fulfillment = activeFulfillments[0];
  const stage = order.cancelled_at ? 'cancelled'
    : order.fulfillment_status === 'fulfilled' && activeFulfillments.length > 0
      && activeFulfillments.every(f => f.shipment_status === 'delivered') ? 'delivered'
    : fulfillment?.shipment_status === 'out_for_delivery' ? 'out_for_delivery'
    : fulfillment?.shipment_status === 'in_transit' ? 'in_transit'
    : fulfillment?.tracking_number ? 'label_created' : 'unknown';
  return {
    workspaceId, orderId: String(order.id),
    revision: createHash('sha256').update(JSON.stringify([order.shipping_address, order.total_price,
      order.currency, order.line_items])).digest('hex'),
    observedAt: now, stageSince: Date.parse(order.updated_at), stage,
    // Shopify IDs and fulfillment do not establish the corresponding Dropi ID.
    identityVerified: false, dataComplete: !!order.shipping_address?.address1,
    stockVerified: false, canDispatchExisting: false, canCancelExisting: false,
    optedOut: false, humanReview: false, callPending: false, retryScheduled: false,
    trackingNumber: fulfillment?.tracking_number ?? undefined,
    confirmation: { completed: false, allAttemptsAccountedFor: false, deliveryFailureUnresolved: false },
  };
}

/** Live read-only simulation. Never call the automation engine from this reader.
 * Shopify tracking notes cannot become official Dropi incidents. New page reads
 * do not prove a state transition or extend the lifecycle of an existing case.
 */
export async function readLogisticsReview(db: SupabaseClient, workspaceId: string, locale: Locale,
  cursor?: string, fetcher: typeof fetch = fetch) {
  const now = Date.now();
  const connection = await db.from('dropi_connections').select('status,api_key_encrypted')
    .eq('workspace_id', workspaceId).maybeSingle();
  if (connection.error) throw new Error('logistics_connection_read_failed');
  const dropiConnected = connection.data?.status === 'connected' && !!connection.data?.api_key_encrypted;
  const admin = await resolveShopifyAdmin(db, workspaceId);
  const base = { mode: 'draft' as const, executable: false as const, observedAt: now,
    dropiConnected, blockers: ['logistics_not_activated', 'dropi_contract_not_verified',
      ...(!dropiConnected ? ['dropi_not_connected'] : [])] };
  if (!admin) return { ...base, blockers: [...base.blockers, 'shopify_read_unavailable'], orders: [], nextCursor: null };
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(admin.shopDomain)) throw new Error('invalid_shop_domain');
  if (cursor && (!/^[A-Za-z0-9_+=/-]+$/.test(cursor) || cursor.length > 2048)) throw new Error('invalid_cursor');
  const params = new URLSearchParams({ limit: '25', fields: 'id,name,created_at,updated_at,cancelled_at,total_price,currency,fulfillment_status,shipping_address,phone,line_items,fulfillments' });
  if (cursor) params.set('page_info', cursor); else params.set('status', 'any');
  const response = await fetcher(`https://${admin.shopDomain}/admin/api/${admin.apiVersion}/orders.json?${params}`, {
    headers: { 'X-Shopify-Access-Token': admin.accessToken }, cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`shopify_logistics_read_${response.status}`);
  const data = await response.json() as { orders?: ShopifyOrder[] };
  if (!Array.isArray(data.orders)) throw new Error('shopify_orders_missing');
  const orders = [];
  for (const order of data.orders) {
    const summary = confirmationSummary(order as unknown as Record<string, unknown>);
    const snapshot = shopifyLogisticsSnapshot(order, workspaceId, now);
    const phone = String(order.shipping_address?.phone ?? order.phone ?? '').replace(/[^\d+]/g, '');
    const phones = [...new Set([phone, phone.replace(/^\+/, ''), phone ? '+' + phone.replace(/^\+/, '') : ''])].filter(Boolean);
    const contactQuery = phones.length ? await db.from('contacts').select('id').eq('workspace_id', workspaceId).in('phone', phones).limit(2) : null;
    if (contactQuery?.error) throw new Error('logistics_contact_read_failed');
    const contactId = contactQuery?.data?.length === 1 ? contactQuery.data[0].id : null;
    const callsQuery = await db.from('voice_calls').select('id,status,outcome,summary,ended_at,created_at,context')
      .eq('workspace_id', workspaceId).contains('context', { order_id: String(order.id) })
      .order('created_at', { ascending: false }).limit(10);
    if (callsQuery.error) throw new Error('logistics_calls_read_failed');
    const calls = (callsQuery.data ?? []).map(c => ({ id: c.id, status: c.status, outcome: c.outcome,
      summary: c.summary, endedAt: c.ended_at, dataOnly: c.context?.cod_writeback === false }));
    snapshot.callPending = calls.some(c => ['queued', 'dialing', 'in_progress'].includes(c.status));
    let messages: Array<{ id: string; sender: string; text: string; status: string; at: string }> = [];
    if (contactId) {
      const conversations = await db.from('conversations').select('id').eq('workspace_id', workspaceId).eq('contact_id', contactId).limit(10);
      if (conversations.error) throw new Error('logistics_conversation_read_failed');
      const ids = (conversations.data ?? []).map(c => c.id);
      if (ids.length) {
        const rows = await db.from('messages').select('id,sender_type,content_text,status,created_at')
          .in('conversation_id', ids).gte('created_at', order.created_at).order('created_at', { ascending: false }).limit(20);
        if (rows.error) throw new Error('logistics_message_read_failed');
        messages = (rows.data ?? []).map(m => ({ id: m.id, sender: m.sender_type,
          text: String(m.content_text ?? '').slice(0, 1500), status: m.status, at: m.created_at }));
      }
    }
    const fulfillment = order.fulfillments?.find(f => f.status !== 'cancelled');
    const trackingCandidate = resolveCarrierTrackingUrl(fulfillment?.tracking_company, fulfillment?.tracking_number);
    orders.push({ id: String(order.id), name: order.name,
      recipient_name: summary.recipient_name, order_items: summary.order_items,
      delivery_address: summary.delivery_address, delivery_phone: summary.delivery_phone,
      ...confirmationDisplayVars({ ...summary, total_price: order.total_price, currency: order.currency }, locale),
      source: 'shopify' as const, stage: snapshot.stage,
      trackingNumber: fulfillment?.tracking_number ?? null, carrier: fulfillment?.tracking_company ?? null,
      trackingCandidate, trackingVerified: false, calls, messages,
      contextNote: 'contact_history_not_order_confirmation',
      proposal: planLogisticsDraft(snapshot, now),
    });
  }
  return { ...base, orders, nextCursor: nextPageInfo(response.headers.get('link')) };
}
