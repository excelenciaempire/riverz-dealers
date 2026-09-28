import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ receipt: vi.fn() }));
vi.mock('../estado-de-entrega', () => ({ marcarEntrega: mocks.receipt }));
vi.mock('../admin-client', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('unexpected unscoped receipt lookup'); } }) }));
import { instagramAdapter } from './adapter';
import type { ChannelConnection } from '@/types';
afterEach(() => vi.clearAllMocks());
it('applies an Instagram read receipt with mid to that message only', async () => {
  const connection = { id: 'connection', workspace_id: 'workspace', config: { ig_user_id: 'self' } } as unknown as ChannelConnection;
  const payload = { entry: [{ id: 'self', messaging: [{ sender: { id: 'customer' }, recipient: { id: 'self' }, read: { mid: 'exact-message' }, timestamp: 1 }] }] };
  const events = await instagramAdapter.parseWebhook({ request: new Request('https://app.test'), rawBody: JSON.stringify(payload), payload }, connection);
  expect(events).toEqual([]);
  expect(mocks.receipt).toHaveBeenCalledWith(expect.anything(), { workspaceId: 'workspace', channel: 'instagram', estado: 'read', externalMessageIds: ['exact-message'] });
});
