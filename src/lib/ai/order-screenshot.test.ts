import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { OrderSummary } from '../shopify/order-lookup';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), rest: vi.fn() }));
vi.mock('../shopify/order-lookup', () => ({ lookupCustomerOrders: mocks.lookup }));
vi.mock('../shopify/admin-client', () => ({ ShopifyAdminClient: class { rest = mocks.rest } }));
import { captureCustomerOrder, orderScreenshotMessageId, renderOrderScreenshot } from './order-screenshot';

const order: OrderSummary = {
  name: '#1008', created_at: '', financial_status: 'pending', fulfillment_status: null,
  total_price: '249900', currency: 'COP', tracking_number: null, tracking_url: null,
  line_items: [{ title: 'Puma <XL> & zapatos', quantity: 1, variant_title: 'Negro / 39', variant_id: '42', product_id: '25', properties: [] }],
};
const input = { shopDomain: 'example.myshopify.com', accessToken: 'test', apiVersion: '2026-07', customerPhone: '573001234567', orderNumber: '1008', language: 'es' };
describe('order screenshots', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
  it('rejects an order absent from verified customer orders before reading images', async () => {
    mocks.lookup.mockResolvedValue({ found: false, orders: [] });
    await expect(captureCustomerOrder(input)).rejects.toThrow('order_not_owned');
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it('does not show the cover or another variant as the purchased variant', async () => {
    mocks.lookup.mockResolvedValue({ found: true, orders: [order] });
    mocks.rest.mockResolvedValue({ product: { images: [{ src: 'https://cdn.shopify.com/other.png', variant_ids: ['99'] }] } });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const shot = await captureCustomerOrder(input);
    expect(fetch).not.toHaveBeenCalled();
    expect((await sharp(shot.png).metadata()).format).toBe('png');
  });
  it('rejects arbitrary image hosts even if saved in product metadata', async () => {
    mocks.lookup.mockResolvedValue({ found: true, orders: [order] });
    mocks.rest.mockResolvedValue({ product: { images: [{ src: 'http://127.0.0.1/private', variant_ids: ['42'] }] } });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await captureCustomerOrder(input);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('renders accented text and XML safely in both languages', async () => {
    for (const language of ['es', 'en']) {
      const png = await renderOrderScreenshot(order, [null], language);
      expect(await sharp(png).metadata()).toMatchObject({ width: 900, height: 320, format: 'png' });
    }
    await expect(renderOrderScreenshot({ ...order, line_items: [] }, [], 'es')).rejects.toThrow('unsupported_order_size');
  });
  it('deduplicates retries without conflating different orders or customers', () => {
    const id = orderScreenshotMessageId('c1', 'm1', '#1008');
    expect(id).toBe(orderScreenshotMessageId('c1', 'm1', '#1008'));
    expect(id).not.toBe(orderScreenshotMessageId('c1', 'm1', '#1009'));
    expect(id).not.toBe(orderScreenshotMessageId('c2', 'm1', '#1008'));
  });
});
