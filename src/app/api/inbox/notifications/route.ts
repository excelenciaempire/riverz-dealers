import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { UUID } from '@/lib/inbox/collaboration'

async function context() {
  const t = (key: string) => translate(locale, `inbox.${key}`)
  const locale = await getLocale()
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: t('teamUnauthorized') }, { status: 401 }) }
  const workspaceId = await resolveWorkspaceIdForUser(client, user.id)
  if (!workspaceId) return { response: NextResponse.json({ error: t('teamNotFound') }, { status: 404 }) }
  return { db: supabaseAdmin(), readDb: client, userId: user.id, workspaceId, t }
}

export async function GET() {
  const ctx = await context()
  if (ctx.response) return ctx.response
  const [list, count] = await Promise.all([
    ctx.readDb.from('workspace_notifications').select('id,conversation_id,created_at,read_at,conversation_notes(body)')
      .eq('workspace_id', ctx.workspaceId).eq('user_id', ctx.userId).order('created_at', { ascending: false }).limit(40),
    ctx.readDb.from('workspace_notifications').select('id', { count: 'exact', head: true })
      .eq('workspace_id', ctx.workspaceId).eq('user_id', ctx.userId).is('read_at', null),
  ])
  if (list.error || count.error) return serverError(list.error ?? count.error, ctx.t('teamFailed'))
  return NextResponse.json({ notifications: list.data ?? [], unread: count.count ?? 0 }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request) {
  const blocked = await csrfGuard(request)
  if (blocked) return blocked
  const ctx = await context()
  if (ctx.response) return ctx.response
  const body = await request.json().catch(() => null)
  if (!Array.isArray(body?.ids) || body.ids.length < 1 || body.ids.length > 40 || !body.ids.every((id: unknown) => typeof id === 'string' && UUID.test(id))) {
    return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  }
  const updated = await ctx.db.from('workspace_notifications').update({ read_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId).eq('user_id', ctx.userId).in('id', body.ids).is('read_at', null)
  if (updated.error) return serverError(updated.error, ctx.t('teamFailed'))
  return NextResponse.json({ ok: true })
}
