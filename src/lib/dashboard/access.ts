import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export class DashboardAccessError extends Error {
  constructor() { super('dashboard_forbidden'); }
}
const identity = z.string().uuid();
/** Only case IDs are fetched before permission-filtered report data. */
export async function visibleDashboardCases(db: SupabaseClient, workspaceId: string, actorId: string): Promise<Set<string>> {
  if (!identity.safeParse(workspaceId).success || !identity.safeParse(actorId).success) throw new DashboardAccessError();
  const visible = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 500; page++) {
    const result = await db.rpc('visible_dashboard_cases', { p_workspace_id: workspaceId, p_actor_id: actorId, p_after: after });
    if (result.error?.message === 'dashboard_forbidden') throw new DashboardAccessError();
    if (result.error) throw new Error('dashboard_access_unavailable');
    const parsed = z.array(identity).max(1000).safeParse(result.data);
    if (!parsed.success) throw new Error('dashboard_access_unavailable');
    for (const id of parsed.data) {
      if (visible.has(id) || after !== null && id <= after) throw new Error('dashboard_access_unavailable');
      visible.add(id); after = id;
    }
    if (parsed.data.length < 1000) return visible;
  }
  throw new Error('dashboard_access_limit');
}

/** A changed source scope is unavailable, never a stale report with private rows. */
export async function assertDashboardScope(db: SupabaseClient, workspaceId: string, actorId: string, previous: Set<string>) {
  const current = await visibleDashboardCases(db, workspaceId, actorId);
  if (current.size !== previous.size || [...previous].some(id => !current.has(id))) throw new Error('dashboard_scope_changed');
}
