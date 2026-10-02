import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { assertDashboardScope, visibleDashboardCases } from './access';
const ws = '00000000-0000-4000-8000-000000000001', actor = '00000000-0000-4000-8000-000000000002';
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
describe('report scope pagination', () => {
  it('reads complete pages of private IDs without loading report content first', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, n) => id(n + 1)) })
      .mockResolvedValueOnce({ data: [id(1001), id(1002)] });
    expect((await visibleDashboardCases({ rpc } as unknown as SupabaseClient, ws, actor)).size).toBe(1002);
    expect(rpc).toHaveBeenLastCalledWith('visible_dashboard_cases', { p_workspace_id: ws, p_actor_id: actor, p_after: id(1000) });
  });
  it.each([{ data: null }, { data: ['not-a-case'] }, { data: [id(3), id(3)] }, { error: { message: 'private failure' } }])('rejects malformed or failed scope: %s', async result => {
    await expect(visibleDashboardCases({ rpc: async () => result } as unknown as SupabaseClient, ws, actor)).rejects.toThrow('dashboard_access_unavailable');
  });
  it('never allows revocation or source disappearance to return the old report', async () => {
    const db = { rpc: async () => ({ data: [] }) } as unknown as SupabaseClient;
    await expect(assertDashboardScope(db, ws, actor, new Set([id(3)]))).rejects.toThrow('dashboard_scope_changed');
  });
  it('does not interpret an API key label or missing identity as an actor', async () => {
    const rpc = vi.fn(); await expect(visibleDashboardCases({ rpc } as unknown as SupabaseClient, ws, 'key-label')).rejects.toThrow('dashboard_forbidden');
    expect(rpc).not.toHaveBeenCalled();
  });
});
