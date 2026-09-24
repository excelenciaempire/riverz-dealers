import { afterEach, describe, expect, it, vi } from 'vitest';
const mirror = vi.hoisted(() => vi.fn().mockResolvedValue('creado'));
vi.mock('./espejo-de-pedido', () => ({ espejarPedidoDeShopify: mirror }));
vi.mock('./admin-client', () => ({ markShopifyConnectionExpired: vi.fn() }));
import { esTiendaDeRevisionDeShopify, sincronizarPedidosDeShopify, sincronizarPedidosDeUnaTienda } from './sincronizar-pedidos';
afterEach(() => { vi.unstubAllGlobals(); mirror.mockReset().mockResolvedValue('creado'); });
const args = { workspaceId: 'workspace-a', shopDomain: 'a.myshopify.com', accessToken: 'token', maxPaginas: 1 };
describe('Shopify app review stores', () => {
  it('excludes only ephemeral app-review domains from merchant order sync', () => {
    expect(esTiendaDeRevisionDeShopify('app-review-6c0d5fed-r114292-a0-primary.myshopify.com')).toBe(true);
    expect(esTiendaDeRevisionDeShopify('a.myshopify.com')).toBe(false);
    expect(esTiendaDeRevisionDeShopify('app-review-real-store.example.com')).toBe(false);
  });
  it('does not call the orders API for a review store in the scheduled sync', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const query = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(),
      range: vi.fn().mockResolvedValue({ data: [{
        id: 'review', workspace_id: 'workspace-a',
        shop_domain: 'app-review-6c0d5fed-r114292-a0-primary.myshopify.com',
        access_token: 'unused', sync_state: {},
      }], error: null }),
    };
    for (const method of ['select', 'eq', 'in', 'order'] as const) query[method].mockReturnValue(query);
    const db = { from: vi.fn().mockReturnValue(query) } as never;
    expect(await sincronizarPedidosDeShopify(db)).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
describe('resumable passive order recovery', () => {
  it('uses a small batch when resuming an existing cursor', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ orders: [] })));
    vi.stubGlobal('fetch', request);
    await sincronizarPedidosDeUnaTienda({} as never, {
      ...args, pageSize: 25,
      nextPage: 'https://a.myshopify.com/admin/api/2025-10/orders.json?page_info=cursor&limit=250',
    });
    const url = new URL(request.mock.calls[0][0]);
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('page_info')).toBe('cursor');
  });
  it('retains the next page instead of reporting a capped pass as complete', async () => {
    const next = 'https://a.myshopify.com/admin/api/2025-10/orders.json?page_info=cursor';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ orders: [{ id: 1 }] }), {
      headers: { Link: `<${next}>; rel="next"` },
    })));
    const result = await sincronizarPedidosDeUnaTienda({} as never, args);
    expect(result).toMatchObject({ complete: false, nextPage: next, creados: 1 });
    expect(mirror).toHaveBeenCalledWith({}, expect.objectContaining({ workspaceId: 'workspace-a', shopDomain: args.shopDomain }));
  });
  it('does not advance past an order that failed to persist', async () => {
    mirror.mockRejectedValue(new Error('database unavailable'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ orders: [{ id: 1 }] }))));
    const result = await sincronizarPedidosDeUnaTienda({} as never, args);
    expect(result).toMatchObject({ complete: false, error: 'order_mirror_failed' });
    expect(result.nextPage).toContain('/orders.json');
  });
  it('rejects cursors belonging to another store before exposing credentials', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    await expect(sincronizarPedidosDeUnaTienda({} as never, {
      ...args, nextPage: 'https://b.myshopify.com/admin/api/2025-10/orders.json',
    })).rejects.toThrow('invalid_shopify_sync_cursor');
    expect(request).not.toHaveBeenCalled();
  });
  it('finishes an exhausted page and only mirrors records', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ orders: [] }))));
    expect(await sincronizarPedidosDeUnaTienda({} as never, args)).toMatchObject({ complete: true, nextPage: null });
  });
});
