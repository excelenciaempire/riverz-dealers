import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  workspace: 'workspace-a' as string | null,
  contacts: [] as Array<Record<string, unknown>>,
  writes: [] as Array<{ table: string; value: unknown }>,
  send: vi.fn(),
}));
vi.mock('react', () => ({ useState: (value: unknown) => [value, vi.fn()] }));
vi.mock('@/lib/api/fetch-with-csrf', () => ({ useFetchWithCsrf: () => state.send }));
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => state.workspace }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'owner' } } } }) },
    from(table: string) {
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain, range: () => chain,
        insert(value: unknown) { state.writes.push({ table, value }); return chain; },
        single: async () => ({ data: { id: 'campaign-a' }, error: null }),
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/paginate', () => ({
  chunk: (rows: unknown[]) => [rows],
  fetchAllRows: vi.fn().mockImplementation(async () => state.contacts),
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
  state.writes = [];
  state.send.mockClear();
});

describe('campaign workspace persistence', () => {
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
});
