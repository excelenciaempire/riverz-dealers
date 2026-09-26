import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/shopify/order-tags', () => ({
  resolveShopifyAdmin: vi.fn(async () => ({
    shopDomain: 'shop.myshopify.com',
    apiVersion: '2026-07',
    accessToken: 'test-token',
  })),
}));
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: vi.fn(async () => {}) }));
vi.mock('@/lib/webhooks/outbound', () => ({ emitWebhook: vi.fn(async () => {}) }));
vi.mock('@/lib/shopify/offers', () => ({
  resolveOfferChosen: vi.fn(async () => ({ label: '2x1', units: 2 })),
}));
vi.mock('@/lib/shopify/contact-upsert', () => ({
  extractShopifyPhone: vi.fn(() => '573217357571'),
  extractShopifyName: vi.fn(() => 'Carlos Castaño'),
  extractShopifyLegacyPhone: vi.fn(() => ''),
  upsertWhatsappContact: vi.fn(async () => 'contact-new'),
}));

import { runAutomationsForTrigger } from '@/lib/automations/engine';
import {
  normalizeTrackingNumber,
  recordManualTracking,
} from './missing-tracking';

const ORDER_ID = '844f76ab-8556-40e9-9450-d2e17335720c';

function database(mirror: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const key of ['select', 'eq']) q[key] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data: mirror, error: null }));
  q.update = vi.fn((patch: Record<string, unknown>) => {
    updates.push(patch);
    return q;
  });
  q.then = vi.fn((resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve));
  return { db: { from: vi.fn(() => q) } as unknown as SupabaseClient, updates };
}

const mirror = {
  id: ORDER_ID,
  shop_domain: 'shop.myshopify.com',
  shopify_order_id: '12406809657708',
  status: 'created',
  contact_id: 'contact-1',
  tracking_number: null,
};

const shopifyOrder = (extra: Record<string, unknown> = {}) =>
  vi.fn(async () =>
    new Response(
      JSON.stringify({
        order: {
          id: 12406809657708,
          name: '#1011',
          financial_status: 'pending',
          fulfillments: [],
          line_items: [
            { title: 'Puma Suede XL', variant_title: 'Negro / 42', quantity: 1 },
            { title: 'Puma Suede XL', variant_title: 'Gris / 42', quantity: 1 },
          ],
          ...extra,
        },
      }),
    ),
  );

const args = { workspaceId: 'ws', orderId: ORDER_ID, trackingNumber: ' 1140 1559 1855 ', carrier: 'envia' };

beforeEach(() => vi.clearAllMocks());

describe('manual tracking for orders the logistics app never synced', () => {
  it('normalizes what the merchant pastes and rejects free text', () => {
    expect(normalizeTrackingNumber(' 1140 1559 1855 ')).toBe('114015591855');
    expect(normalizeTrackingNumber('ya salió')).toBeNull();
    expect(normalizeTrackingNumber('')).toBeNull();
  });

  it('saves the tracking and fires the same shipping automations Shopify would', async () => {
    const { db, updates } = database(mirror);
    expect(await recordManualTracking(db, args, shopifyOrder())).toBe('sent');
    expect(updates[0]).toMatchObject({
      tracking_number: '114015591855',
      tracking_company: 'Envía',
      tracking_source: 'manual',
      tracking_url: 'https://hub.envia.co/landingrastreo/Rastreo/Index?guia=114015591855',
    });
    expect(runAutomationsForTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'shopify_order_fulfilled',
        contactId: 'contact-1',
        context: {
          vars: expect.objectContaining({
            tracking_number: '114015591855',
            tracking_company: 'Envía',
            order_items: '1 × Puma Suede XL (Negro / 42)\n1 × Puma Suede XL (Gris / 42)',
            offer_chosen: '2x1',
          }),
        },
      }),
    );
  });

  it('does not announce a shipment for an order cancelled in the store', async () => {
    const { db, updates } = database(mirror);
    expect(await recordManualTracking(db, args, shopifyOrder({ cancelled_at: '2026-09-26' }))).toBe('cancelled');
    expect(updates).toHaveLength(0);
    expect(runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('leaves it to the webhook when the store already has the tracking', async () => {
    const { db } = database(mirror);
    const fetcher = shopifyOrder({ fulfillments: [{ status: 'success', tracking_number: '999' }] });
    expect(await recordManualTracking(db, args, fetcher)).toBe('already_tracked');
    expect(runAutomationsForTrigger).not.toHaveBeenCalled();
  });

  it('does not resend when the same tracking is submitted twice', async () => {
    const { db } = database({ ...mirror, tracking_number: '114015591855' });
    const fetcher = shopifyOrder();
    expect(await recordManualTracking(db, args, fetcher)).toBe('already_recorded');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses an order from another workspace or store', async () => {
    const { db } = database(null);
    expect(await recordManualTracking(db, args, shopifyOrder())).toBe('not_found');
  });
});
