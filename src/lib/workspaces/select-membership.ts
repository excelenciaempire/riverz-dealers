import type { Workspace, WorkspaceMember } from '@/types';

type Membership = WorkspaceMember & { workspace?: Workspace | null };

/** Same precedence as resolveWorkspaceIdForUser: owned workspace, then oldest membership. */
export function selectWorkspaceMembership(rows: Membership[], userId: string): Membership | null {
  const live = rows.filter((row) => row.workspace && !row.workspace.deleted_at);
  const owned = live.filter((row) => row.workspace?.owner_id === userId);
  const candidates = owned.length ? owned : live;
  return candidates.sort((a, b) => {
    const dateA = owned.length ? a.workspace!.created_at : a.joined_at;
    const dateB = owned.length ? b.workspace!.created_at : b.joined_at;
    return (dateA ?? '').localeCompare(dateB ?? '') || a.workspace_id.localeCompare(b.workspace_id);
  })[0] ?? null;
}
