import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve workspaces.id from a Shopify connection's user_id.
 *
 * `shopify_connections.user_id` stores the auth.users.id of whoever
 * connected the store — that's NOT the workspace id automations live
 * under. Prior calls passed the user_id directly to
 * runAutomationsForTrigger, which would query
 * `automations.workspace_id = <auth.users.id>` and silently match
 * nothing.
 *
 * Resolution order:
 *
 *   1. workspaces.owner_id = userId   (the common case — the connector
 *      is the workspace owner)
 *   2. workspace_members.user_id = userId, first row
 *      (covers workspaces where ownership rotated or the connector is
 *      a non-owner admin/agent)
 *
 * Returns null when no workspace matches — callers should log + skip
 * the dispatch instead of falling through with a wrong id.
 */
export async function resolveWorkspaceIdForUser(
  db: SupabaseClient,
  userId: string,
): Promise<string | null> {
  if (!userId) return null

  const { data: owned } = await db
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const ownedId = (owned as { id?: string } | null)?.id
  if (ownedId) return ownedId

  const { data: member } = await db
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (member as { workspace_id?: string } | null)?.workspace_id ?? null
}
