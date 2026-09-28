import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/channels/admin-client', () => ({ supabaseAdmin: () => mocks }));
import { getOpsStatus, listChannels } from './queries';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});

function rowsByTable(tables: Record<string, unknown[]>, failure?: string) {
  mocks.from.mockImplementation((table: string) => {
    const rows = tables[table] ?? [];
    const q = {
      select: vi.fn(() => q),
      is: vi.fn(() => q),
      eq: vi.fn(() => q),
      neq: vi.fn(() => q),
      lt: vi.fn(() => q),
      order: vi.fn(() => q),
      in: vi.fn(async () => ({ data: rows, error: null })),
      range: vi.fn(async (from: number, to: number) => ({
        data: failure ? null : rows.slice(from, to + 1),
        error: failure ? { message: failure } : null,
      })),
    };
    return q;
  });
}

it('counts every pending webhook by provider, but limits the recent detail to 50', async () => {
  rowsByTable({ webhook_events_raw: Array.from({ length: 1005 }, (_, i) => ({
    id: i, provider: i < 1000 ? 'shopify' : 'tiktok',
    received_at: new Date(i * 1000).toISOString(), attempts: 1, last_error: 'error',
  })) });
  const result = await getOpsStatus();
  expect(result.webhooks.unprocessed).toBe(1005);
  expect(result.webhooks.byProvider).toEqual([
    { provider: 'shopify', unprocessed: 1000 }, { provider: 'tiktok', unprocessed: 5 },
  ]);
  expect(result.webhooks.failing).toHaveLength(50);
  expect(result.webhooks.failing[0].id).toBe(1004);
});

it('does not turn a database failure into a healthy zero-incidents result', async () => {
  rowsByTable({}, 'database unavailable');
  await expect(getOpsStatus()).rejects.toThrow('database unavailable');
});

it('does not display a disabled integration as connected', async () => {
  rowsByTable({ workspace_integrations: [
    { id: 'disabled', workspace_id: 'w', provider: 'stripe', is_active: false, expires_at: null },
    { id: 'active', workspace_id: 'w', provider: 'stripe', is_active: true, expires_at: null },
    { id: 'expired', workspace_id: 'w', provider: 'stripe', is_active: true, expires_at: '2000-01-01' },
  ] });
  const result = await listChannels({});
  expect(result.rows.map(r => r.status)).toEqual(['disconnected', 'connected', 'expired']);
});
