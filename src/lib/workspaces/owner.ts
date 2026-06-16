import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve the workspace owner's auth.users.id from workspaces.id.
 *
 * Used by every engine path that needs to call provider helpers keyed
 * on `user_id` (the legacy single-tenant column on `contacts`,
 * `whatsapp_config`, etc.). Without this, callers would have to pass
 * `workspace_id` into a column that expects `auth.users.id` and every
 * lookup would silently return null.
 *
 * Returns null when the workspace doesn't have an owner row (shouldn't
 * happen — owner_id is NOT NULL on workspaces — but we tolerate it so a
 * stale lookup doesn't kill the caller).
 */
export async function resolveWorkspaceOwnerUserId(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  if (!workspaceId) return null
  const { data, error } = await db
    .from('workspaces')
    .select('owner_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (error) {
    console.error('[workspaces] owner lookup failed:', error)
    return null
  }
  return (data as { owner_id?: string } | null)?.owner_id ?? null
}
