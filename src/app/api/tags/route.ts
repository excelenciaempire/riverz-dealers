import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { csrfGuard } from '@/lib/csrf'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { ensureTag } from '@/lib/contacts/tags'

/**
 * POST /api/tags — find-or-create a tag by NAME for the caller's workspace,
 * returning the tag. Lets the automation builder (and others) offer "write a
 * new tag or pick an existing one" without leaving the editor. Race-safe via
 * ensureTag (select-then-insert, deduped by name).
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  const name = String(body.name ?? '')
    .trim()
    .slice(0, 60)
  if (!name) return NextResponse.json({ error: 'empty_name' }, { status: 400 })

  const id = await ensureTag(supabase, workspaceId, name)
  if (!id) return NextResponse.json({ error: 'create_failed' }, { status: 500 })

  const { data } = await supabase
    .from('tags')
    .select('id, name, color')
    .eq('id', id)
    .maybeSingle()
  return NextResponse.json({ tag: data ?? { id, name, color: null } })
}
