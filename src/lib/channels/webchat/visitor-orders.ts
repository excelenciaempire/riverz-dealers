import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { WebchatSession } from './token';
import { parseVisitorOrderCursor, visitorOrderPage, type VisitorOrderPage } from './order-contract';

/** Match the signed visitor to its exact contact. An asserted email, phone,
 * unified identity or a guessed order number never broadens this read. */
export async function loadVisitorOrders(db: SupabaseClient, session: WebchatSession, rawCursor?: string): Promise<VisitorOrderPage> {
  const cursor = rawCursor ? parseVisitorOrderCursor(rawCursor) : null;
  const contact = await db.from('contacts').select('id')
    .eq('workspace_id', session.workspaceId).eq('channel', 'webchat')
    .eq('external_id', session.visitorId).maybeSingle();
  if (contact.error) throw new Error('visitor_order_unavailable');
  if (!contact.data) return { orders: [], next_cursor: null };
  if (!z.string().uuid().safeParse(contact.data.id).success) throw new Error('visitor_order_unavailable');

  let query = db.from('orders').select('id,order_number,created_at')
    .eq('workspace_id', session.workspaceId).eq('contact_id', contact.data.id)
    .not('order_number', 'is', null)
    .order('created_at', { ascending: false }).order('id', { ascending: false });
  if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  const page = await query.limit(21);
  if (page.error || !Array.isArray(page.data)) throw new Error('visitor_order_unavailable');
  const rows = page.data.slice(0, 20).map(row => ({ id: row.id, reference: row.order_number, created_at: row.created_at }));
  const next = page.data.length > 20 && rows.length ? JSON.stringify({ id: rows[rows.length - 1].id, created_at: rows[rows.length - 1].created_at }) : null;
  const result = visitorOrderPage.safeParse({ orders: rows, next_cursor: next });
  if (!result.success) throw new Error('visitor_order_unavailable');
  return result.data;
}
