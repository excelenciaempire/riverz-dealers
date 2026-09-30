import { NextResponse } from 'next/server'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { inboxActions } from '@/lib/inbox/case-actions'
import { UUID } from '@/lib/inbox/collaboration'
import { inboxSession } from '@/lib/inbox/server-context'

export async function GET() {
  const ctx = await inboxSession()
  if (ctx.response) return ctx.response
  const [macros, tags] = await Promise.all([
    ctx.client.from('inbox_macros').select('id,name,actions,version,is_active,created_by').eq('workspace_id', ctx.workspaceId).eq('is_active', true).order('name').limit(100),
    ctx.client.from('tags').select('id,name').eq('workspace_id', ctx.workspaceId).order('name'),
  ])
  if (macros.error || tags.error) return serverError(macros.error ?? tags.error, ctx.t('teamFailed'))
  return NextResponse.json({ macros: macros.data ?? [], tags: tags.data ?? [], user_id: ctx.userId, is_admin: ctx.isAdmin }, { headers: { 'Cache-Control': 'private, no-store' } })
}
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await inboxSession()
  if (ctx.response) return ctx.response
  const body = await request.json().catch(() => null)
  const actions = inboxActions(body?.actions, { macro: true })
  if (!actions || typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 80 || Object.keys(body).some(k => !['name', 'actions'].includes(k))) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  const quota = await ctx.db.from('inbox_macros').select('id', { head: true, count: 'exact' }).eq('workspace_id', ctx.workspaceId).eq('is_active', true)
  if (quota.error) return serverError(quota.error, ctx.t('teamFailed'))
  if ((quota.count ?? 0) >= 100) return NextResponse.json({ error: ctx.t('macroLimit') }, { status: 409 })
  const saved = await ctx.db.from('inbox_macros').insert({ workspace_id: ctx.workspaceId, created_by: ctx.userId, name: body.name.trim(), actions })
    .select('id,name,actions,version,is_active,created_by').single()
  if (saved.error) return serverError(saved.error, ctx.t('teamFailed'))
  return NextResponse.json({ macro: saved.data }, { status: 201 })
}
export async function DELETE(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await inboxSession()
  if (ctx.response) return ctx.response
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  const query = ctx.db.from('inbox_macros').update({ is_active: false, updated_at: new Date().toISOString() }).eq('workspace_id', ctx.workspaceId).eq('id', id)
  if (!ctx.isAdmin) query.eq('created_by', ctx.userId)
  const updated = await query.select('id').maybeSingle()
  if (updated.error) return serverError(updated.error, ctx.t('teamFailed'))
  if (!updated.data) return NextResponse.json({ error: ctx.t('teamNotFound') }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await inboxSession()
  if (ctx.response) return ctx.response
  const b = await request.json().catch(() => null)
  const actions = inboxActions(b?.actions, { macro: true })
  if (!actions || !UUID.test(b?.id ?? '') || !Number.isInteger(b.version) || b.version < 1 || typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 80 ||
    Object.keys(b).some(k => !['id', 'name', 'actions', 'version'].includes(k))) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  const query = ctx.db.from('inbox_macros').update({ name: b.name.trim(), actions, version: b.version + 1, updated_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId).eq('id', b.id).eq('version', b.version).eq('is_active', true)
  if (!ctx.isAdmin) query.eq('created_by', ctx.userId)
  const saved = await query.select('id,name,actions,version,is_active,created_by').maybeSingle()
  if (saved.error) return serverError(saved.error, ctx.t('teamFailed'))
  if (!saved.data) return NextResponse.json({ error: ctx.t('macroChanged') }, { status: 409 })
  return NextResponse.json({ macro: saved.data })
}
