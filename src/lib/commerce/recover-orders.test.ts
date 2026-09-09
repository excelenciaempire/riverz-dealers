import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ stores: vi.fn(), get: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/db/paginate', () => ({ selectAll: mocks.stores }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (value: string) => value }));
vi.mock('@/lib/contacts/purchases', () => ({ recordPurchases: vi.fn() }));
vi.mock('@/lib/shopify/espejo-de-pedido', () => ({ espejarPedidoDeShopify: vi.fn() }));
vi.mock('./providers/tiendanube', () => ({
  TiendanubeClient: class { get = mocks.get; }, normalizeTiendanubeOrder: vi.fn(),
}));
vi.mock('./providers/woocommerce', () => ({
  WooCommerceClient: class { get = mocks.get; }, normalizeWooOrder: vi.fn(),
}));
import { recoverCommerceOrders } from './recover-orders';
afterEach(() => vi.resetAllMocks());
describe('commerce recovery page checkpoints', () => {
  it.each([{ page: 1, size: 25, empty404: false }, { page: 3, size: 100, empty404: false },
    { page: 1, size: 25, empty404: true }])(
    'preserves page width for page $page (empty response $empty404)', async ({ page, size, empty404 }) => {
      mocks.stores.mockResolvedValue([{ id: 'store', workspace_id: 'workspace', platform: 'tiendanube',
        shop_domain: 'store.test', external_store_id: '1', access_token: 'token', sync_state: { page },
      }]);
      if (empty404) mocks.get.mockRejectedValue(new Error('Tiendanube API 404: {"code":404,"description":"Last page is 0"}'));
      else mocks.get.mockResolvedValue([]);
      const chain = { eq: vi.fn(), in: vi.fn().mockResolvedValue({ error: null }) };
      chain.eq.mockReturnValue(chain);
      mocks.update.mockReturnValue(chain);
      const db = { from: vi.fn().mockReturnValue({ update: mocks.update }) };
      expect(await recoverCommerceOrders(db as never)).toEqual([
        { id: 'store', platform: 'tiendanube', recovered: 0, complete: true },
      ]);
      expect(mocks.get).toHaveBeenCalledWith(expect.stringContaining(`per_page=${size}&page=${page}`));
      expect(mocks.update).toHaveBeenCalledWith({ sync_state: expect.objectContaining({ page_size: 25, complete: true }) });
      expect(chain.eq).toHaveBeenCalledWith('id', 'store');
    },
  );
});
