import type { SupabaseClient } from '@supabase/supabase-js';
import { selectedCommerceInBrowser } from '@/lib/auth/commerce-cookies';
import { resolveWorkspaceIdForUser as resolveCore } from './resolve-core';

/** Browser queries stay RLS-scoped; no server session or signing code enters the bundle. */
export function resolveWorkspaceIdForUser(db: SupabaseClient, userId: string) {
  return resolveCore(db, userId, selectedCommerceInBrowser());
}
