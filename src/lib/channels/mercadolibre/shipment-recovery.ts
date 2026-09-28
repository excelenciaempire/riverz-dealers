import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import { supabaseAdmin } from '../admin-client';
import { listConnections } from '../connections';
import { getFreshMLToken } from './adapter';
import { throwIfRateLimited, isMlRateLimit } from './rate-limit';

type Capture = { id: string; raw_body: string; received_at: string; last_error: string | null };
type Shipment = { id?: number; sender_id?: number; status?: string; tracking_number?: string | null; tracking_method?: string | null };
type Order = { id?: number; seller?: { id?: number }; shipping?: { id?: number }; status?: string; payments?: Array<{ status?: string }> };
type Mirror = { id: string; updated_at: string; order_status_url: string | null; shipping_status: string | null;
  tracking_number: string | null; tracking_company: string | null; tracking_url: string | null;
  fulfillment_status: string | null; status: string };
type Outcome = { shipmentId: string; events: number; state: 'ready' | 'needs_sync' | 'recovered' | 'pending';
  orders?: number; changedFields?: string[]; reason?: string };

/** Only delivery mirrors. Never ingest messages, run automations or mutate money. */
export async function reconcileCapturedShipments(options: { apply?: boolean; limit?: number } = {}) {
  const db = supabaseAdmin();
  const { data, error } = await db.from('webhook_events_raw')
    .select('id,raw_body,received_at,last_error').eq('provider', 'mercadolibre:token')
    .is('processed_at', null).order('received_at').limit(1000);
  if (error) throw new Error('shipment_recovery_capture_read_failed');
  const groups = new Map<string, { sellerId: string; shipmentId: string; events: Capture[] }>();
  for (const event of (data ?? []) as Capture[]) {
    let body: { topic?: string; resource?: string; user_id?: string | number };
    try { body = JSON.parse(event.raw_body); } catch { continue; }
    const match = body.resource?.match(/^\/shipments\/(\d+)$/);
    const sellerId = String(body.user_id ?? '');
    if (body.topic !== 'shipments' || !match || !/^\d+$/.test(sellerId)) continue;
    const key = `${sellerId}:${match[1]}`;
    if (!groups.has(key)) groups.set(key, { sellerId, shipmentId: match[1], events: [] });
    groups.get(key)!.events.push(event);
  }
  if (!groups.size) return { recovered: 0, checked: 0, remainingShipments: 0, results: [] as Outcome[] };
  const connections = await listConnections(db, { channel: 'mercadolibre', statuses: [] });
  const tokens = new Map<string, string>();
  const results: Outcome[] = [];
  let recovered = 0;
  const limit = Math.max(1, Math.min(40, Math.floor(options.limit ?? 10)));
  for (const group of [...groups.values()].slice(0, limit)) {
    const base = { shipmentId: group.shipmentId, events: group.events.length };
    try {
      const matches = connections.filter(c => String(c.config?.seller_id ?? '') === group.sellerId);
      if (!matches.length || matches.some(c => c.status !== 'connected')) throw new Error('shipment_connection_unavailable');
      const changedFields = new Set<string>();
      let orders = 0;
      for (const connection of matches) {
        let token = tokens.get(connection.id);
        if (!token) { token = await getFreshMLToken(connection); tokens.set(connection.id, token); }
        const check = await reconcileShipmentMirror(db, connection, group.shipmentId, token, options.apply === true);
        check.changedFields.forEach(f => changedFields.add(f));
        orders += check.orders;
      }
      if (options.apply) {
        for (const event of group.events) {
          const update = await db.from('webhook_events_raw').update({
            processed_at: new Date().toISOString(),
            last_error: `reviewed: shipment ${group.shipmentId} and ${orders} scoped order mirrors verified against provider; previous: ${event.last_error ?? ''}`,
          }).eq('id', event.id).is('processed_at', null).select('id');
          if (update.error) throw new Error('shipment_recovery_receipt_write_failed');
          recovered += update.data?.length ?? 0;
        }
      }
      results.push({ ...base, orders, changedFields: [...changedFields],
        state: options.apply ? 'recovered' : changedFields.size ? 'needs_sync' : 'ready' });
    } catch (err) {
      results.push({ ...base, state: 'pending', reason: err instanceof Error ? err.message : 'shipment_recovery_failed' });
      if (isMlRateLimit(err)) break;
    }
  }
  return { recovered, checked: results.length, remainingShipments: groups.size - results.filter(r => r.state === 'recovered').length, results };
}

async function read<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
  });
  throwIfRateLimited(response, 'shipment recovery');
  if (!response.ok) throw new Error(`shipment_provider_http_${response.status}`);
  return response.json() as Promise<T>;
}

export async function reconcileShipmentMirror(db: SupabaseClient, connection: ChannelConnection,
  shipmentId: string, token: string, apply: boolean): Promise<{ orders: number; changedFields: string[] }> {
  if (!/^\d+$/.test(shipmentId)) throw new Error('shipment_id_invalid');
  const sellerId = String(connection.config?.seller_id ?? '');
  const shipment = await read<Shipment>(`/shipments/${shipmentId}`, token);
  if (String(shipment.id ?? '') !== shipmentId || String(shipment.sender_id ?? '') !== sellerId || !shipment.status) {
    throw new Error('shipment_owner_or_identity_mismatch');
  }
  const items = await read<Array<{ order_id?: number }>>(`/shipments/${shipmentId}/items`, token);
  if (!Array.isArray(items)) throw new Error('shipment_items_invalid');
  const ids = [...new Set(items.map(i => String(i.order_id ?? '')).filter(id => /^\d+$/.test(id)))];
  if (!ids.length || ids.length > 50) throw new Error('shipment_orders_unresolved');
  const changedFields = new Set<string>();
  for (const id of ids) {
    const order = await read<Order>(`/orders/${id}`, token);
    if (String(order.id ?? '') !== id || String(order.seller?.id ?? '') !== sellerId || String(order.shipping?.id ?? '') !== shipmentId) {
      throw new Error('shipment_order_scope_mismatch');
    }
    const query = await db.from('orders').select('id,updated_at,order_status_url,shipping_status,tracking_number,tracking_company,tracking_url,fulfillment_status,status')
      .eq('workspace_id', connection.workspace_id).eq('platform', 'mercadolibre')
      .eq('shop_domain', `mercadolibre:${sellerId}`).eq('shopify_order_id', id).maybeSingle();
    if (query.error || !query.data) throw new Error('shipment_order_mirror_missing');
    const mirror = query.data as Mirror;
    const payment = order.payments?.[0]?.status;
    const status = order.status === 'cancelled' ? 'cancelled' : ['refunded', 'charged_back'].includes(payment ?? '') ? 'refunded'
      : shipment.status === 'delivered' ? 'fulfilled' : payment === 'approved' || order.status === 'paid' ? 'paid' : 'created';
    const patch = { shipping_status: shipment.status, tracking_number: shipment.tracking_number ?? null,
      tracking_company: shipment.tracking_method ?? null,
      tracking_url: shipment.tracking_number ? mirror.order_status_url : null,
      fulfillment_status: shipment.status === 'delivered' ? 'fulfilled' : null, status };
    const changed = (Object.keys(patch) as Array<keyof typeof patch>).filter(k => patch[k] !== mirror[k]);
    changed.forEach(f => changedFields.add(f));
    if (apply && changed.length) {
      const updated = await db.from('orders').update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', mirror.id).eq('workspace_id', connection.workspace_id).eq('updated_at', mirror.updated_at).select('id');
      if (updated.error || updated.data?.length !== 1) throw new Error('shipment_order_mirror_concurrent_change');
    }
  }
  return { orders: ids.length, changedFields: [...changedFields] };
}
