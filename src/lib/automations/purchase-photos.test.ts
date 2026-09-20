/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory fluent database fixture. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const send = vi.hoisted(() => vi.fn());
vi.mock('./meta-send', () => ({ engineSendTemplate: send }));
import { sendPurchasePhotos } from './purchase-photos';

const args = { workspaceId: 'w', conversationId: 'c', contactId: 'buyer', automationId: 'a',
  automationName: 'Confirmation', stepId: 's', language: 'es', vars: {
    order_id: 'order-1', purchase_shop_domain: 'shop.myshopify.com', purchase_order_lines: JSON.stringify([
      { id: 1, product_id: 100, variant_id: 20, title: 'Shoes', variant_title: 'Black / 37', quantity: 2 },
      { id: 2, product_id: 100, variant_id: 30, title: 'Shoes', variant_title: 'Red / 36', quantity: 1 },
    ]),
  } };
function fixture() {
  const tables: Record<string, any[]> = {
    messages: [],
    message_templates: [{ workspace_id: 'w', name: 'deuna_foto_referencia_v1', language: 'es', status: 'Approved', category: 'Utility', header_type: 'image' }],
    shopify_products: [
      { workspace_id: 'foreign', shop_domain: 'shop.myshopify.com', platform: 'shopify', external_id: 100, raw: { id: 100 } },
      { workspace_id: 'w', shop_domain: 'shop.myshopify.com', platform: 'shopify', external_id: 100,
        raw: { id: 100, variants: [{ id: 20, image_id: 2 }, { id: 30 }],
          images: [{ id: 1, src: 'https://cdn.shopify.com/white.jpg' }, { id: 2, src: 'https://cdn.shopify.com/black.jpg' }] } },
    ],
  };
  const db = { from(table: string) {
    const filters: Array<(r: any) => boolean> = [];
    let op = 'select', payload: any, single = false;
    const q: any = {
      select: () => q,
      eq: (key: string, value: any) => { filters.push(r => r[key] === value); return q; },
      in: (key: string, value: any[]) => { filters.push(r => value.map(String).includes(String(r[key]))); return q; },
      maybeSingle: () => { single = true; return q; },
      insert: (value: any) => { op = 'insert'; payload = value; return q; },
      update: (value: any) => { op = 'update'; payload = value; return q; },
      then: (resolve: any, reject: any) => Promise.resolve().then(() => {
        if (op === 'insert') {
          if (tables[table].some(r => r.id === payload.id)) return { data: null, error: { code: '23505' } };
          tables[table].push({ ...payload });
        }
        const found = tables[table].filter(r => filters.every(f => f(r)));
        if (op === 'update') found.forEach(r => Object.assign(r, payload));
        return { data: single ? found[0] : found, error: null };
      }).then(resolve, reject),
    }; return q;
  } } as unknown as SupabaseClient;
  return { db, tables };
}
beforeEach(() => { send.mockReset().mockResolvedValue({ whatsapp_message_id: 'wamid.1' }); });
describe('purchase photo delivery', () => {
  it('sends exactly the purchased reference, skips missing images and deduplicates retries', async () => {
    const { db } = fixture();
    expect(await sendPurchasePhotos(db, args)).toContain('sent=1, unavailable=1');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      headerImageUrl: 'https://cdn.shopify.com/black.jpg', params: ['2 × Shoes (Black / 37)'], reason: 'transaccional',
    }));
    expect(await sendPurchasePhotos(db, args)).toContain('already_claimed=1');
    expect(send).toHaveBeenCalledTimes(1);
    await sendPurchasePhotos(db, { ...args, vars: { ...args.vars, order_id: 'order-2' } });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('records an uncertain failure without resending or throwing away the textual confirmation', async () => {
    const { db, tables } = fixture();
    send.mockRejectedValue(new Error('Network timeout'));
    expect(await sendPurchasePhotos(db, args)).toContain('failed=1');
    expect(tables.messages[0]).toMatchObject({ status: 'failed', error_reason: 'Network timeout' });
    await sendPurchasePhotos(db, args);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not use another store or an unapproved/marketing template', async () => {
    const { db, tables } = fixture();
    expect(await sendPurchasePhotos(db, { ...args, vars: { ...args.vars, purchase_shop_domain: 'other' } })).toContain('unavailable=2');
    tables.message_templates[0].category = 'Marketing';
    expect(await sendPurchasePhotos(db, args)).toContain('not approved');
    expect(send).not.toHaveBeenCalled();
  });
});
