import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  workspace: 'workspace-a' as string | null,
  contacts: [] as Array<Record<string, unknown>>,
  recipients: [] as Array<Record<string, unknown>>,
  writes: [] as Array<{ table: string; value: unknown }>,
  send: vi.fn(),
}));
vi.mock('react', () => ({ useState: (value: unknown) => [value, vi.fn()] }));
vi.mock('@/lib/api/fetch-with-csrf', () => ({ useFetchWithCsrf: () => state.send }));
vi.mock('@/lib/workspaces/resolve-browser', () => ({ resolveWorkspaceIdForUser: async () => state.workspace }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) },
    from(table: string) {
      const chain = {
        testTable: table,
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain, range: () => chain,
        insert(value: unknown) { state.writes.push({ table, value }); return chain; },
        update(value: unknown) { state.writes.push({ table, value }); return chain; },
        single: async () => ({ data: { id: 'campaign-a' }, error: null }),
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/paginate', () => ({
  chunk: (rows: unknown[]) => [rows],
  fetchAllRows: vi.fn().mockImplementation(async (make: (from: number, to: number) => { testTable: string }) => {
    const table = make(0, 999).testTable;
    return table === 'contacts' ? state.contacts : table === 'broadcast_recipients' ? state.recipients : [];
  }),
}));
vi.mock('@/lib/broadcasts/conversations', () => ({ recordBroadcastConversation: vi.fn() }));
vi.mock('@/lib/segments/resolve', () => ({ resolveSegment: vi.fn() }));

import { useBroadcastSending } from './use-broadcast-sending';
import type { MessageTemplate } from '@/types';

const payload = {
  name: 'Review test',
  template: { name: 'review_test', language: 'es' } as MessageTemplate,
  audience: { type: 'all' as const },
  variables: {},
  scheduledAt: '2099-01-01T00:00:00Z',
};

beforeEach(() => {
  state.workspace = 'workspace-a';
  state.contacts = [{ id: 'contact-a', workspace_id: 'workspace-a', phone: '15555550100' }];
  state.recipients = [{ id: 'recipient-a', contact: state.contacts[0] }];
  state.writes = [];
  state.send.mockClear();
});

describe('campaign workspace persistence', () => {
  it('persists dynamic positions before sending and resolves name and Shopify fields beside fixed text', async () => {
    state.contacts[0].name = 'Ana Perez';
    state.contacts[0].shopify_customer_data = { orders_count: 3 };
    state.send.mockResolvedValue(new Response(JSON.stringify({ results: [{ recipient_id: 'recipient-a', status: 'sent' }] })));
    await useBroadcastSending().createAndSendBroadcast({ ...payload, scheduledAt: null, variables: {
      '1': { type: 'field', value: 'first_name' }, '2': { type: 'static', value: 'Shipping excluded' }, '3': { type: 'field', value: 'shopify_orders_count' },
    } });
    expect(state.writes.find(w => w.table === 'broadcasts')?.value).toMatchObject({ variable_mapping: { '1': 'first_name', '3': 'shopify_orders_count' } });
    expect(state.writes.find(w => w.table === 'broadcast_recipients')?.value).toEqual([{ broadcast_id: 'campaign-a', contact_id: 'contact-a', status: 'pending', params: ['Ana', 'Shipping excluded', '3'] }]);
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('stores the workspace required by the database and keeps other workspace contacts out', async () => {
    state.contacts.push({ id: 'contact-b', workspace_id: 'workspace-b', phone: '15555550101' });
    await expect(useBroadcastSending().createAndSendBroadcast(payload)).resolves.toBe('campaign-a');
    expect(state.writes.find(w => w.table === 'broadcasts')?.value).toMatchObject({ workspace_id: 'workspace-a', total_recipients: 1, status: 'scheduled' });
    expect(state.writes.find(w => w.table === 'broadcast_recipients')?.value).toEqual([{ broadcast_id: 'campaign-a', contact_id: 'contact-a', status: 'pending', params: [] }]);
    expect(state.send).not.toHaveBeenCalled();
  });

  it('stops before writing or sending when no workspace can be resolved', async () => {
    state.workspace = null;
    await expect(useBroadcastSending().createAndSendBroadcast(payload)).rejects.toThrow('workspace_required');
    expect(state.writes).toEqual([]);
    expect(state.send).not.toHaveBeenCalled();
  });

  it('sends only persisted ids to the protected batch endpoint and leaves result writes to the server', async () => {
    state.send.mockResolvedValue(new Response(JSON.stringify({ results: [{ recipient_id: 'recipient-a', status: 'sent' }] })));
    await useBroadcastSending().createAndSendBroadcast({ ...payload, scheduledAt: null });
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0]).toBe('/api/broadcasts/send-batch');
    expect(JSON.parse(state.send.mock.calls[0][1].body)).toEqual({ broadcast_id: 'campaign-a', recipient_ids: ['recipient-a'], finalize: true });
    expect(state.writes.filter(w => w.table === 'broadcast_recipients')).toHaveLength(1);
    expect(state.writes.filter(w => w.table === 'broadcasts')).toHaveLength(1);
  });

  it('preserves uncertain responses as pending work for recovery without resending or marking recipients failed', async () => {
    state.send.mockRejectedValue(new Error('response interrupted'));
    await useBroadcastSending().createAndSendBroadcast({ ...payload, scheduledAt: null });
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.writes.filter(w => w.table === 'broadcast_recipients')).toHaveLength(1);
    expect(state.writes.at(-1)?.value).toMatchObject({ status: 'scheduled', scheduled_at: expect.any(String) });
  });
});
