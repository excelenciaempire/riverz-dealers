import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve workspaces.id from an auth.users.id.
 *
 * Legacy provider tables (whatsapp_config, shopify_connections, …)
 * store `user_id` = auth.users.id, NOT the workspace id that
 * automations live under. Passing the user_id directly to
 * runAutomationsForTrigger would query
 * `automations.workspace_id = <auth.users.id>` and silently match
 * nothing.
 *
 * Resolution order (deterministic):
 *
 *   1. workspaces.owner_id = userId   (the common case — the connector
 *      is the workspace owner; the owner's home workspace is the
 *      correct semantic default)
 *   2. workspace_members.user_id = userId, ordered by joined_at ASC,
 *      then workspace_id ASC as tie-breaker so two memberships created
 *      in the same millisecond still resolve deterministically.
 *
 * Returns null when no workspace matches — callers should log + skip
 * the dispatch instead of falling through with a wrong id.
 */
export async function resolveWorkspaceIdForUser(
  db: SupabaseClient,
  userId: string,
): Promise<string | null> {
  if (!userId) return null

  // Los workspaces BORRADOS quedan fuera de la resolución: si no, una cuenta
  // que eliminó su workspace inicial resolvía a ese (más antiguo) mientras la
  // UI —que sí descarta los borrados— mostraba el vivo, y todo lo que se
  // escribía caía en un workspace muerto sin datos.
  const { data: owned } = await db
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const ownedId = (owned as { id?: string } | null)?.id
  if (ownedId) return ownedId

  const { data: member } = await db
    .from('workspace_members')
    .select('workspace_id, workspaces!inner(deleted_at)')
    .eq('user_id', userId)
    .is('workspaces.deleted_at', null)
    .order('joined_at', { ascending: true })
    .order('workspace_id', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (member as { workspace_id?: string } | null)?.workspace_id ?? null
}
