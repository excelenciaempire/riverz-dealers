import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('../shopify/order-lookup', () => ({ lookupCustomerOrders: mocks.lookup }));
import { runTool, LOOKUP_ORDER_TOOL, UPDATE_ORDER_TOOL, type LocalOrdersContext } from './tools';
const shopify = { shopDomain: 'example.myshopify.com', accessToken: 'test', apiVersion: '2026-07', customerPhone: '573001234567', channel: 'whatsapp' as const };
beforeEach(() => { vi.clearAllMocks(); mocks.lookup.mockResolvedValue({ found: true, orders: [{ name: '#1008' }] }); });
it('offers screenshots on the read tool, never the order mutation tool', () => {
  expect(LOOKUP_ORDER_TOOL.input_schema.properties).toHaveProperty('include_screenshot');
  expect(UPDATE_ORDER_TOOL.input_schema.properties).not.toHaveProperty('include_screenshot');
});
it('queues a specific order and truthfully reports unavailable captures', async () => {
  const queue = vi.fn(async () => {});
  const ctx = { db: {}, workspaceId: 'w1', contactId: 'c1', queueOrderScreenshot: queue } as unknown as LocalOrdersContext;
  const input = { order_number: '#1008', include_screenshot: true, reason: 'compare variants' };
  expect(JSON.parse(await runTool('lookup_order', input, shopify, null, ctx)).screenshot).toBe('queued_with_reply');
  expect(queue).toHaveBeenCalledWith('#1008');
  queue.mockRejectedValueOnce(new Error('not owned'));
  expect(JSON.parse(await runTool('lookup_order', input, shopify, null, ctx)).screenshot).toBe('unavailable');
  queue.mockClear();
  await runTool('lookup_order', input, shopify, null, { ...ctx, simulacion: true });
  expect(queue).not.toHaveBeenCalled();
});
