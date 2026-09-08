import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  questions: vi.fn(),
  messages: vi.fn(),
  orders: vi.fn(),
  catalog: vi.fn(),
  reviews: vi.fn(),
  claims: vi.fn(),
  subtasks: [] as string[],
}));

vi.mock('@/lib/auth/cron', () => ({ assertCronAuth: vi.fn() }));
vi.mock('@/lib/cron/heartbeat', () => ({
  withCronRun: (
    _name: string,
    handler: (request: Request) => Promise<Response>
  ) => handler,
  withCronTask: async <T>(name: string, task: () => Promise<T>): Promise<T> => {
    mocks.subtasks.push(name);
    return task();
  },
}));
vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => {
    const chain: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (value: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(resolve);
          }
          if (prop === 'maybeSingle') {
            return () => Promise.resolve({ data: null, error: null });
          }
          return () => chain;
        },
      }
    );
    return { from: () => chain };
  },
}));
vi.mock('@/lib/channels/mercadolibre/poll', () => ({
  pollAllMercadoLibreConnections: mocks.questions,
}));
vi.mock('@/lib/channels/mercadolibre/messages-poll', () => ({
  pollAllMercadoLibreMessages: mocks.messages,
}));
vi.mock('@/lib/channels/mercadolibre/orders', () => ({
  syncAllMercadoLibreOrders: mocks.orders,
}));
vi.mock('@/lib/channels/mercadolibre/catalog', () => ({
  syncAllMercadoLibreCatalogs: mocks.catalog,
}));
vi.mock('@/lib/channels/mercadolibre/reviews', () => ({
  pollAllMercadoLibreReviews: mocks.reviews,
}));
vi.mock('@/lib/channels/mercadolibre/claims-poll', () => ({
  pollAllMercadoLibreClaims: mocks.claims,
}));

import { GET } from './route';

const ok = () => ({ failures: [] });

describe('Mercado Libre cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subtasks.length = 0;
    mocks.questions.mockResolvedValue(ok());
    mocks.messages.mockResolvedValue(ok());
    mocks.orders.mockResolvedValue(ok());
    mocks.catalog.mockResolvedValue(ok());
    mocks.reviews.mockResolvedValue(ok());
    mocks.claims.mockResolvedValue(ok());
  });

  it('fuerza una pasada completa, incluidos los reclamos de todas las conexiones', async () => {
    const response = await GET(
      new Request('http://localhost/api/cron/mercadolibre?force=1')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.questions).toHaveBeenCalledOnce();
    expect(mocks.messages).toHaveBeenCalledOnce();
    expect(mocks.orders).toHaveBeenCalledOnce();
    expect(mocks.claims).toHaveBeenCalledOnce();
    expect(mocks.catalog).toHaveBeenCalledOnce();
    expect(mocks.reviews).toHaveBeenCalledOnce();
    expect(mocks.subtasks).toEqual([
      'mercadolibre-orders',
      'mercadolibre-claims',
      'mercadolibre-catalog',
      'ml-reviews',
    ]);
    expect(body.ok).toBe(true);
  });

  it('devuelve fallo parcial cuando una sola conexión no pudo sincronizar reclamos', async () => {
    mocks.claims.mockResolvedValue({
      failures: [{ connectionId: 'ml-2', error: 'Graph 500' }],
    });

    const response = await GET(
      new Request('http://localhost/api/cron/mercadolibre?force=1')
    );
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body.ok).toBe(false);
    expect(body.failed).toBe(1);
    expect(body.claims.failures).toHaveLength(1);
    expect(body.claims.error).toContain('Graph 500');
    expect(body.error).toContain('claims: Graph 500');
  });
});
