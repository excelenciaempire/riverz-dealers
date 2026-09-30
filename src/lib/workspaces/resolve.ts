import type { SupabaseClient } from '@supabase/supabase-js';
import { commerceWorkspaceForUser } from '@/lib/admin/commerce-session';
import { resolveWorkspaceIdForUser as resolveCore } from './resolve-core';

export { isWorkspaceAdmin, isMemberOfLiveWorkspace } from './resolve-core';

/** Signed request selection; cron/provider calls retain the deterministic default. */
export async function resolveWorkspaceIdForUser(db: SupabaseClient, userId: string): Promise<string | null> {
  if (!userId) return null;
  return resolveCore(db, userId, await commerceWorkspaceForUser(userId));
}
