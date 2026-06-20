import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * App-level, idempotent fallback for workspace provisioning.
 *
 * A brand-new merchant's workspace is normally created by the DB trigger
 * `handle_new_workspace_for_user` (supabase/migrations/013_unified_inbox.sql),
 * which fires AFTER INSERT on auth.users. That trigger swallows errors
 * (EXCEPTION WHEN OTHERS → RAISE WARNING), so if it ever fails the user
 * ends up authenticated with NO workspace — the dashboard breaks and they
 * cannot create products or connect channels with no way to recover.
 *
 * This helper mirrors the trigger's column choices and guarantees that an
 * authenticated user always has a workspace. It is fully idempotent: it
 * re-checks membership first and never creates a second workspace for a
 * user who already has one.
 *
 * MUST be called with a SERVICE-ROLE client (`supabaseAdmin()`): the
 * `workspaces` / `workspace_members` RLS policies are membership-based,
 * so a stranded user (zero memberships) cannot insert their own first
 * workspace under their anon/cookie session.
 */
export async function ensureWorkspace(
  admin: SupabaseClient,
  userId: string,
  email: string | null | undefined,
  meta?: Record<string, unknown> | null,
): Promise<string | null> {
  if (!userId) return null

  // Idempotency check #1: does the user already resolve to a workspace?
  // resolveWorkspaceIdForUser covers both owner_id and membership, which
  // is exactly the "already has one" condition we must not duplicate.
  const existing = await resolveWorkspaceIdForUser(admin, userId)
  if (existing) return existing

  // Name = COALESCE(metadata workspace_name, email local-part + "'s workspace")
  // — mirrors the trigger in migration 013 (lines ~307-313).
  const metaName =
    typeof meta?.workspace_name === 'string' && meta.workspace_name.trim()
      ? (meta.workspace_name as string)
      : null
  const localPart = (email ?? '').split('@')[0] || 'mi'
  const workspaceName = metaName ?? `${localPart}'s workspace`

  // Create the workspace owned by this user.
  const { data: created, error: wsErr } = await admin
    .from('workspaces')
    .insert({ name: workspaceName, owner_id: userId })
    .select('id')
    .single()

  if (wsErr || !created) {
    // Race: a concurrent caller (or a delayed trigger) may have created
    // the workspace between our check and this insert. Re-resolve and
    // return whatever now exists rather than surfacing a hard failure.
    const recheck = await resolveWorkspaceIdForUser(admin, userId)
    if (recheck) return recheck
    if (wsErr) throw wsErr
    return null
  }

  const workspaceId = (created as { id: string }).id

  // Create the admin membership row. Mirror migration 013 (role 'admin').
  const { error: memberErr } = await admin
    .from('workspace_members')
    .insert({ workspace_id: workspaceId, user_id: userId, role: 'admin' })

  if (memberErr) {
    // The UNIQUE(workspace_id, user_id) constraint makes a duplicate
    // membership a no-op semantically; only surface non-conflict errors.
    const recheck = await resolveWorkspaceIdForUser(admin, userId)
    if (recheck) return recheck
    throw memberErr
  }

  return workspaceId
}
