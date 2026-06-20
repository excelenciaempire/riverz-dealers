import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { ensureWorkspace } from '@/lib/workspaces/ensure'

/**
 * Idempotent workspace-provisioning fallback.
 *
 * A new merchant's workspace is normally created by the DB trigger
 * `handle_new_workspace_for_user` (migration 013), which swallows errors.
 * If that trigger ever fails, the user is left authenticated with no
 * workspace and no recovery path. This route (and the matching call in the
 * dashboard layout) self-heals that: it guarantees the signed-in user has
 * a workspace, creating one only when missing.
 *
 * Auth: uses the cookie-bound client to identify the caller, then performs
 * the write with the service-role admin client (workspace RLS is
 * membership-based, so a stranded user can't insert their own first row).
 */
async function handle() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  try {
    const workspaceId = await ensureWorkspace(
      supabaseAdmin(),
      user.id,
      user.email,
      user.user_metadata,
    )
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspace_provisioning_failed' },
        { status: 500 },
      )
    }
    return NextResponse.json({ workspaceId })
  } catch (err) {
    console.error('[workspace/bootstrap] failed:', err)
    return NextResponse.json(
      { error: 'workspace_provisioning_failed' },
      { status: 500 },
    )
  }
}

export async function POST() {
  return handle()
}

export async function GET() {
  return handle()
}
