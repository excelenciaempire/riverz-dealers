import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/shopify/order-tags', () => ({ resolveShopifyAdmin: vi.fn() }));
import { resolveShopifyAdmin } from '@/lib/shopify/order-tags';
import { readLogisticsReview, shopifyLogisticsSnapshot } from './logistics-read';
import type { SupabaseClient } from '@supabase/supabase-js';
const now = Date.UTC(2026,8,13);
const order = { id: 1001, name: '#1001', created_at: new Date(now-1000).toISOString(),
  updated_at: new Date(now).toISOString(), cancelled_at: null, total_price: '110000.00', currency: 'COP',
  fulfillment_status: null, shipping_address: { address1: 'Example address' }, line_items: [{ title:'Ball',quantity:1 }] };
describe('live logistics read boundaries', () => {
  it('Shopify does not prove Dropi confirmation, stock or an official incident', () => {
    const snapshot = shopifyLogisticsSnapshot(order,'ws',now);
    expect(snapshot).toMatchObject({ stage:'unknown', identityVerified:false, stockVerified:false,
      canDispatchExisting:false, canCancelExisting:false });
    expect(snapshot.incident).toBeUndefined();
  });
  it('generating a guide does not prove physical dispatch', () => {
    const snapshot=shopifyLogisticsSnapshot({ ...order, fulfillments:[{status:'success',shipment_status:null,
      tracking_number:'001234',tracking_company:'ENVIA',tracking_url:null}] },'ws',now);
    expect(snapshot.stage).toBe('label_created');
  });
  it('a partially delivered shipment does not mark the entire order delivered', () => {
    const snapshot=shopifyLogisticsSnapshot({ ...order, fulfillment_status:'partial', fulfillments:[{
      status:'success',shipment_status:'delivered',tracking_number:'001234',tracking_company:'ENVIA',tracking_url:null }] },'ws',now);
    expect(snapshot.stage).not.toBe('delivered');
  });
  it('changes the confirmation revision if the address or product changes, not if polled later', () => {
    const key=shopifyLogisticsSnapshot(order,'ws',now).revision;
    expect(shopifyLogisticsSnapshot(order,'ws',now+1).revision).toBe(key);
    expect(shopifyLogisticsSnapshot({...order,shipping_address:{address1:'New address'}},'ws',now).revision).not.toBe(key);
    expect(shopifyLogisticsSnapshot({...order,total_price:'120000'},'ws',now).revision).not.toBe(key);
  });
  it('no live connection returns explicit blockers without calling a shipping API', async () => {
    vi.mocked(resolveShopifyAdmin).mockResolvedValue(null);
    const query={ select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:null,error:null}) };
    const fetcher=vi.fn();
    const report=await readLogisticsReview({from:()=>query} as unknown as SupabaseClient,'ws','es',undefined,fetcher);
    expect(report.executable).toBe(false);
    expect(report.blockers).toContain('dropi_not_connected');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
