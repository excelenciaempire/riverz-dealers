import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { csrfGuard } from '@/lib/csrf'
import {
  getConnectionForUser,
  getConnectionForWorkspace,
} from '@/lib/shopify/connection'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * Settings card connection state. Post-055 we prefer workspace_id (so a
 * second member of the same workspace sees the connection too), and
 * fall back to the legacy user_id read for users with no workspace yet.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  const conn = workspaceId
    ? await getConnectionForWorkspace(supabase, workspaceId)
    : await getConnectionForUser(supabase, user.id)
  const configured = Boolean(process.env.SHOPIFY_API_KEY)
  return NextResponse.json({ configured, connection: conn })
}

/** Disconnect (delete) the workspace's Shopify connection. */
export async function DELETE(req: Request) {
  const block = await csrfGuard(req)
  if (block) return block
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Scope the delete to the workspace, not the installer's user_id —
  // any workspace member should be able to disconnect.
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (workspaceId) {
    const { error } = await supabase
      .from('shopify_connections')
      .delete()
      .eq('workspace_id', workspaceId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Legacy fallback for users without a workspace row.
    const { error } = await supabase
      .from('shopify_connections')
      .delete()
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
