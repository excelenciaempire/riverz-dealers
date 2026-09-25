import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import {
  getConnectionForUser,
  getConnectionForWorkspace,
} from '@/lib/shopify/connection'
import { shopifyScopes } from '@/lib/shopify/oauth'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'

/**
 * Settings card connection state. Post-055 we prefer workspace_id (so a
 * second member of the same workspace sees the connection too), and
 * fall back to the legacy user_id read for users with no workspace yet.
 *
 * `oauth`: whether the public app can be installed on any store. Shopify
 * only allows that once the App Store approves it, so it stays off until
 * `SHOPIFY_APP_STORE_APPROVED=true`. `scopes`: what the merchant's own
 * Dev Dashboard app must request.
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
  const oauth =
    Boolean(process.env.SHOPIFY_API_KEY) &&
    process.env.SHOPIFY_APP_STORE_APPROVED === 'true'
  return NextResponse.json({ oauth, scopes: shopifyScopes(), connection: conn })
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
      .eq('platform', 'shopify')
      .eq('workspace_id', workspaceId)
    if (error) return serverError(error)
  } else {
    // Legacy fallback for users without a workspace row.
    const { error } = await supabase
      .from('shopify_connections')
      .delete()
      .eq('platform', 'shopify')
      .eq('user_id', user.id)
    if (error) return serverError(error)
  }
  return NextResponse.json({ ok: true })
}
