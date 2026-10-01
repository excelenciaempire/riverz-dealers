import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('@/lib/channels/gmail/watch', () => ({
  getFreshAccessToken: vi.fn(async () => 'gmail-token'),
}));
vi.mock('./token-vivo', () => ({
  tokenVivo: vi.fn(async () => ({ accessToken: 'shop-token' })),
}));
import { deliverPostPurchaseGuides } from './post-purchase-guide-delivery';
import { guideMessageId } from './post-purchase-guide';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let sends: ReturnType<typeof vi.fn<(init?: RequestInit) => void>>;
let sentId: string | null;
let sendStatus: number;
let order: Row;
// Small transactional query double: conditional updates are evaluated at commit.
function database() {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let action = 'select';
      let change: Row = {};
      let one = false;
      const q = {
        select() {
          return q;
        },
        eq(key: string, value: unknown) {
          filters.push((r) => r[key] === value);
          return q;
        },
        lt(key: string, value: unknown) {
          filters.push((r) => String(r[key]) < String(value));
          return q;
        },
        lte(key: string, value: unknown) {
          filters.push((r) => String(r[key]) <= String(value));
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        single() {
          one = true;
          return q;
        },
        maybeSingle() {
          one = true;
          return q;
        },
        update(value: Row) {
          action = 'update';
          change = value;
          return q;
        },
        upsert(value: Row) {
          action = 'upsert';
          change = value;
          return q;
        },
        then(resolve: (r: unknown) => void) {
          let matched = tables[table].filter((r) => filters.every((f) => f(r)));
          if (action === 'upsert') {
            if (
              tables[table].some(
                (r) =>
                  r.guide_id === change.guide_id &&
                  r.order_id === change.order_id
              )
            )
              matched = [];
            else {
              const row = {
                id: 'delivery',
                status: 'pending',
                attempts: 0,
                next_attempt_at: new Date(0).toISOString(),
                ...change,
              };
              tables[table].push(row);
              matched = [row];
            }
          } else if (action === 'update')
            matched.forEach((r) => Object.assign(r, change));
          resolve({
            data: one ? (matched[0] ?? null) : matched.map((r) => ({ ...r })),
            error:
              one && matched.length === 0 && table === 'channel_connections'
                ? new Error('mailbox_scope_mismatch')
                : null,
          });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}
beforeEach(() => {
  sentId = null;
  sendStatus = 200;
  sends = vi.fn();
  order = {
    id: 99,
    name: '#99',
    created_at: '2026-10-01T15:01:00Z',
    financial_status: 'paid',
    email: 'buyer@example.com',
    line_items: [
      { product_id: 'shampoo', quantity: 3 },
      { product_id: 'gift', quantity: 1 },
    ],
  };
  tables = {
    post_purchase_guides: [
      {
        id: 'guide',
        workspace_id: 'ws',
        shop_domain: 'test.myshopify.com',
        connection_id: 'mail',
        guide_product_id: 'gift',
        qualifying_product_id: 'shampoo',
        minimum_quantity: 3,
        file_url: 'https://cdn.shopify.com/guide.pdf',
        subject: 'Tu guía {{order_name}}',
        body: 'Descarga {{guide_url}}',
        enabled: true,
        enabled_at: '2026-10-01T15:00:00Z',
        scan_after: '2026-10-01T15:00:00Z',
        scan_until: null,
        scan_page_url: null,
      },
    ],
    post_purchase_guide_deliveries: [],
    shopify_connections: [
      {
        workspace_id: 'ws',
        shop_domain: 'test.myshopify.com',
        platform: 'shopify',
        status: 'active',
      },
    ],
    channel_connections: [
      {
        id: 'mail',
        workspace_id: 'ws',
        channel: 'gmail',
        status: 'connected',
        config: { email: 'brand@example.com' },
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/orders.json'))
        return Response.json({ orders: [order] });
      if (url.includes('/orders/99.json')) return Response.json({ order });
      if (url.includes('/messages/send')) {
        sends(init);
        if (sendStatus !== 200) return new Response('', { status: sendStatus });
        sentId = 'gmail-receipt';
        return Response.json({ id: sentId });
      }
      if (url.includes('/messages?'))
        return Response.json({ messages: sentId ? [{ id: sentId }] : [] });
      if (url.includes('/messages/') && url.includes('format=metadata'))
        return Response.json({
          labelIds: ['SENT'],
          payload: {
            headers: [
              {
                name: 'X-Riverz-Guide-Delivery',
                value: guideMessageId('guide', '99'),
              },
            ],
          },
        });
      throw new Error(`unexpected_fetch:${url}`);
    })
  );
});
afterEach(() => vi.unstubAllGlobals());
describe('guide delivery worker', () => {
  it('sends once across concurrent scans, then repeated cron runs do not resend', async () => {
    const db = database();
    await Promise.all([
      deliverPostPurchaseGuides(db),
      deliverPostPurchaseGuides(db),
    ]);
    await deliverPostPurchaseGuides(db);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(tables.post_purchase_guide_deliveries).toHaveLength(1);
    expect(tables.post_purchase_guide_deliveries[0]).toMatchObject({
      status: 'sent',
      external_message_id: 'gmail-receipt',
    });
    const raw = JSON.parse(String(sends.mock.calls[0][0]?.body)).raw;
    const mime = Buffer.from(raw, 'base64url').toString();
    expect(mime).toContain('To: buyer@example.com');
    expect(mime).toContain(guideMessageId('guide', '99'));
    expect(Object.keys(tables)).not.toContain('wallet_transactions');
  });
  it('cannot use a mailbox belonging to another workspace', async () => {
    tables.channel_connections[0].workspace_id = 'other';
    const result = await deliverPostPurchaseGuides(database());
    expect(result.errors).toBe(1);
    expect(sends).not.toHaveBeenCalled();
  });
  it('keeps an ambiguous send for reconciliation, never blindly resends', async () => {
    sendStatus = 502;
    await deliverPostPurchaseGuides(database());
    await deliverPostPurchaseGuides(database());
    expect(sends).toHaveBeenCalledTimes(1);
    expect(tables.post_purchase_guide_deliveries[0].status).toBe('uncertain');
    sentId = 'accepted-despite-timeout';
    const result = await deliverPostPurchaseGuides(database());
    expect(result.reconciled).toBe(1);
    expect(tables.post_purchase_guide_deliveries[0].status).toBe('sent');
    expect(sends).toHaveBeenCalledTimes(1);
  });
  it('retries rate-limit rejection after its scheduled delay', async () => {
    sendStatus = 429;
    await deliverPostPurchaseGuides(database());
    expect(tables.post_purchase_guide_deliveries[0].status).toBe('pending');
    await deliverPostPurchaseGuides(database());
    expect(sends).toHaveBeenCalledTimes(1);
    tables.post_purchase_guide_deliveries[0].next_attempt_at = new Date(
      0
    ).toISOString();
    sendStatus = 200;
    await deliverPostPurchaseGuides(database());
    expect(sends).toHaveBeenCalledTimes(2);
    expect(tables.post_purchase_guide_deliveries[0].status).toBe('sent');
  });
  it('skips invalid/missing recipient email without switching to WhatsApp', async () => {
    order.email = null;
    await deliverPostPurchaseGuides(database());
    expect(sends).not.toHaveBeenCalled();
    expect(tables.post_purchase_guide_deliveries[0].last_error).toBe(
      'missing_order_email'
    );
  });
  it('rechecks eligibility after queueing and cancels a refunded purchase', async () => {
    tables.post_purchase_guide_deliveries.push({
      id: 'd',
      guide_id: 'guide',
      workspace_id: 'ws',
      order_id: '99',
      status: 'pending',
      attempts: 0,
      next_attempt_at: new Date(0).toISOString(),
    });
    order.financial_status = 'refunded';
    await deliverPostPurchaseGuides(database());
    expect(sends).not.toHaveBeenCalled();
    expect(tables.post_purchase_guide_deliveries[0].status).toBe('cancelled');
  });
});
