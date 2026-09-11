import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), token: vi.fn(), reconcile: vi.fn(), construct: vi.fn() }));
vi.mock('@/lib/db/paginate', () => ({ selectAll: mocks.list }));
vi.mock('@/lib/base-url', () => ({ publicBaseUrl: () => 'https://riverz.co' }));
vi.mock('@/lib/shopify/token-vivo', () => ({ tokenVivo: mocks.token, COLUMNAS_TOKEN: 'id,access_token,token_expires_at' }));
vi.mock('@/lib/shopify/admin-client', () => ({
  ShopifyUnauthorizedError: class extends Error {},
  ShopifyAdminClient: class {
    constructor(...args: unknown[]) { mocks.construct(...args); }
    reconcileWebhooks = mocks.reconcile;
  },
}));
import { ShopifyUnauthorizedError } from '@/lib/shopify/admin-client';
import { reconcileAllCommerceWebhooks } from './webhook-reconcile';

const row = { id: 'store', platform: 'shopify', shop_domain: 'shop.myshopify.com',
  access_token: 'expired-encrypted-token', status: 'active' };
function database() {
  const update = vi.fn();
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.in = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
  update.mockReturnValue(chain);
  return { update, from: () => ({ update }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([row]);
  mocks.token.mockResolvedValue({ accessToken: 'renewed-token', renovado: true });
  mocks.reconcile.mockResolvedValue({ created: 0, deleted: 0, kept: 12 });
});

describe('commerce webhook recovery', () => {
  it('renews Shopify credentials before checking subscriptions', async () => {
    const db = database();
    const result = await reconcileAllCommerceWebhooks(db as never);
    expect(mocks.token).toHaveBeenCalledWith(db, row);
    expect(mocks.construct).toHaveBeenCalledWith('shop.myshopify.com', 'renewed-token');
    expect(result.results[0].error).toBeUndefined();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('does not expire a working credential on a resource permission 403', async () => {
    const db = database();
    mocks.reconcile.mockRejectedValue(new Error('Shopify HTTP 403: missing read_orders permission'));
    const result = await reconcileAllCommerceWebhooks(db as never);
    expect(result.results[0].error).toContain('403');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('still marks a confirmed credential rejection as expired', async () => {
    const db = database();
    mocks.reconcile.mockRejectedValue(new ShopifyUnauthorizedError('Shopify HTTP 401'));
    await reconcileAllCommerceWebhooks(db as never);
    expect(db.update).toHaveBeenCalledWith({ status: 'expired' });
  });

  it('restores a previously expired store only after a successful provider check', async () => {
    const db = database();
    mocks.list.mockResolvedValue([{ ...row, status: 'expired' }]);
    await reconcileAllCommerceWebhooks(db as never);
    expect(db.update).toHaveBeenCalledWith({ status: 'active', last_error: null });
  });

  it('does not report zero stores when the database read failed', async () => {
    mocks.list.mockRejectedValue(new Error('upstream request timeout'));
    await expect(reconcileAllCommerceWebhooks(database() as never)).rejects.toThrow('upstream request timeout');
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
