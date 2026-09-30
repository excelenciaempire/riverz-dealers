import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const m = vi.hoisted(() => ({ resolve: vi.fn(), selected: vi.fn() }));
vi.mock('./resolve', () => ({ resolveWorkspaceIdForUser: m.resolve }));
vi.mock('@/lib/admin/commerce-session', () => ({ commerceWorkspaceForUser: m.selected }));
import { ensureWorkspace } from './ensure';
beforeEach(() => { vi.resetAllMocks(); m.resolve.mockResolvedValue(null); m.selected.mockResolvedValue(null); });

it('does not create any store when a delegated selection was deleted or became inaccessible', async () => {
  m.selected.mockResolvedValue('deleted-selected-store');
  const from = vi.fn(() => { throw new Error('must_not_write'); });
  expect(await ensureWorkspace({ from } as unknown as SupabaseClient, 'owner', 'merchant@example.com')).toBeNull();
  expect(from).not.toHaveBeenCalled();
});
it('returns an existing store without provisioning or another context lookup', async () => {
  m.resolve.mockResolvedValue('live-store');
  const from = vi.fn();
  expect(await ensureWorkspace({ from } as unknown as SupabaseClient, 'owner', 'merchant@example.com')).toBe('live-store');
  expect(from).not.toHaveBeenCalled();
  expect(m.selected).not.toHaveBeenCalled();
});
it('retains normal idempotent provisioning for an ordinary newly registered merchant', async () => {
  const workspaceInsert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'new-store' }, error: null }) }) }));
  const memberInsert = vi.fn(async () => ({ error: null }));
  const from = vi.fn((table: string) => ({ insert: table === 'workspaces' ? workspaceInsert : memberInsert }));
  expect(await ensureWorkspace({ from } as unknown as SupabaseClient, 'owner', 'new@example.com', { workspace_name: 'New Store' })).toBe('new-store');
  expect(workspaceInsert).toHaveBeenCalledWith({ name: 'New Store', owner_id: 'owner' });
  expect(memberInsert).toHaveBeenCalledWith({ workspace_id: 'new-store', user_id: 'owner', role: 'admin' });
});
