import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contacts: vi.fn(),
  shopify: vi.fn(),
  commerce: vi.fn(),
}));

vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/contacts/bulk-sync', () => ({
  syncAllWorkspaces: mocks.contacts,
}));
vi.mock('@/lib/shopify/sincronizar-pedidos', () => ({
  sincronizarPedidosDeShopify: mocks.shopify,
}));
vi.mock('@/lib/commerce/recover-orders', () => ({
  recoverCommerceOrders: mocks.commerce,
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronAuth: vi.fn() }));
vi.mock('@/lib/cron/heartbeat', () => ({
  withCronRun: (
    _name: string,
    handler: (request: Request) => Promise<Response>
  ) => handler,
}));

import { GET } from './route';

const workspace = (error?: string) => ({
  workspace_id: 'workspace-1',
  customers: 0,
  processed: 9,
  matched: 0,
  unmatched: 9,
  pending: 0,
  ...(error ? { error } : {}),
});

describe('contacts-sync health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.contacts.mockResolvedValue([workspace()]);
    mocks.shopify.mockResolvedValue([]);
    mocks.commerce.mockResolvedValue([]);
  });

  it('puts the provider failure before the verbose partial results', async () => {
    mocks.shopify.mockResolvedValue([
      {
        shopDomain: 'store.test',
        leidos: 0,
        creados: 0,
        actualizados: 0,
        error: 'HTTP 503',
      },
    ]);

    const response = await GET(
      new Request('http://localhost/api/cron/contacts-sync')
    );
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('shopify store.test: HTTP 503');
    expect(body.workspaces).toEqual([workspace()]);
  });

  it('reports contact enrichment failures as a partial failure', async () => {
    mocks.contacts.mockResolvedValue([
      workspace('shopify 429 en customers.json'),
    ]);

    const response = await GET(
      new Request('http://localhost/api/cron/contacts-sync')
    );
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body.error).toBe(
      'contacts workspace-1: shopify 429 en customers.json'
    );
  });

  it('does not add an error to a healthy run', async () => {
    const response = await GET(
      new Request('http://localhost/api/cron/contacts-sync')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty('error');
  });
});
