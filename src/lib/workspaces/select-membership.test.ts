import { expect, it } from 'vitest';
import { selectWorkspaceMembership } from './select-membership';
import type { Workspace, WorkspaceMember } from '@/types';

function member(id: string, owner: string, joined: string, created = joined, deleted = false) {
  return {
    workspace_id: id, joined_at: joined,
    workspace: { id, owner_id: owner, created_at: created, deleted_at: deleted ? '2026-01-01' : null },
  } as WorkspaceMember & { workspace: Workspace };
}

it('shows the owned workspace even when an older invitation exists', () => {
  const owned = member('own', 'me', '2026-03-01');
  expect(selectWorkspaceMembership([member('invited', 'other', '2026-01-01'), owned], 'me')).toBe(owned);
});
it('uses creation date and id to select between owned workspaces', () => {
  const first = member('a', 'me', '2026-04-01', '2026-01-01');
  expect(selectWorkspaceMembership([member('b', 'me', '2026-02-01', '2026-01-01'), first], 'me')).toBe(first);
});
it('ignores deleted workspaces and resolves membership ties deterministically', () => {
  const first = member('a', 'other', '2026-02-01');
  expect(selectWorkspaceMembership([member('own', 'me', '2026-01-01', undefined, true), member('b', 'other', '2026-02-01'), first], 'me')).toBe(first);
  expect(selectWorkspaceMembership([], 'me')).toBeNull();
});
