import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { serverError } from '@/lib/api/errors'
import { csrfGuard } from '@/lib/csrf'
import { canAccessConversation } from '@/lib/inbox/access'
import { UUID } from '@/lib/inbox/collaboration'

type RouteContext = { params: Promise<{ id: string }> }
async function context(route: RouteContext) {
  const locale = await getLocale()
  const t = (key: string) => translate(locale, `inbox.${key}`)
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: t('teamUnauthorized') }, { status: 401 }) }
  const ws = await resolveWorkspaceIdForUser(client, user.id)
  const { id } = await route.params
  if (!ws || !UUID.test(id)) return { response: NextResponse.json({ error: t('teamNotFound') }, { status: 404 }) }
  const db = supabaseAdmin()
  const source = await db.from('conversations').select('id,contact_id,channel,connection_id').eq('workspace_id', ws).eq('id', id).is('deleted_at', null).maybeSingle()
  if (source.error) return { response: serverError(source.error, t('teamFailed')) }
  if (!source.data) return { response: NextResponse.json({ error: t('teamNotFound') }, { status: 404 }) }
  try {
    if (!(await canAccessConversation(db, user.id, source.data))) return { response: NextResponse.json({ error: t('teamNotFound') }, { status: 404 }) }
  } catch (error) { return { response: serverError(error, t('teamFailed')) } }
  return { db, workspaceId: ws, userId: user.id, source: source.data, t }
}

export async function GET(_request: Request, route: RouteContext) {
  const ctx = await context(route)
  if (ctx.response) return ctx.response
  const [related, links] = await Promise.all([
    ctx.db.from('conversations').select('id,channel,connection_id,last_message_text,last_message_at,status')
      .eq('workspace_id', ctx.workspaceId).eq('contact_id', ctx.source.contact_id).neq('id', ctx.source.id)
      .is('deleted_at', null).not('last_message_at', 'is', null).order('last_message_at', { ascending: false }).limit(50),
    ctx.db.from('conversation_links').select('id,source_conversation_id,target_conversation_id,linked_at')
      .eq('workspace_id', ctx.workspaceId).or(`source_conversation_id.eq.${ctx.source.id},target_conversation_id.eq.${ctx.source.id}`).is('unlinked_at', null),
  ])
  if (related.error || links.error) return serverError(related.error ?? links.error, ctx.t('teamFailed'))
  const candidates = []
  try {
    for (const row of related.data ?? []) if (await canAccessConversation(ctx.db, ctx.userId, row)) candidates.push(row)
    const ids = (links.data ?? []).map(l => l.source_conversation_id === ctx.source.id ? l.target_conversation_id : l.source_conversation_id)
    const targets = ids.length ? await ctx.db.from('conversations').select('id,channel,connection_id,last_message_text,last_message_at,status')
      .eq('workspace_id', ctx.workspaceId).in('id', ids).is('deleted_at', null) : { data: [], error: null }
    if (targets.error) return serverError(targets.error, ctx.t('teamFailed'))
    const visible: { id: string; channel: string; connection_id: string | null; last_message_text: string | null; last_message_at: string | null; status: string }[] = []
    for (const row of targets.data ?? []) if (await canAccessConversation(ctx.db, ctx.userId, row)) visible.push(row)
    return NextResponse.json({ candidates, links: (links.data ?? []).flatMap(link => {
      const targetId = link.source_conversation_id === ctx.source.id ? link.target_conversation_id : link.source_conversation_id
      const target = visible.find(v => v.id === targetId)
      return target ? [{ id: link.id, target, linked_at: link.linked_at }] : []
    }) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return serverError(error, ctx.t('teamFailed')) }
}

export async function POST(request: Request, route: RouteContext) {
  const blocked = await csrfGuard(request)
  if (blocked) return blocked
  const ctx = await context(route)
  if (ctx.response) return ctx.response
  const body = await request.json().catch(() => null)
  if (!UUID.test(body?.target_id ?? '') || body.target_id === ctx.source.id || body.confirmed !== true) return NextResponse.json({ error: ctx.t('relatedConfirm') }, { status: 400 })
  const target = await ctx.db.from('conversations').select('id,contact_id,channel,connection_id').eq('workspace_id', ctx.workspaceId)
    .eq('id', body.target_id).eq('contact_id', ctx.source.contact_id).is('deleted_at', null).maybeSingle()
  if (target.error) return serverError(target.error, ctx.t('teamFailed'))
  if (!target.data) return NextResponse.json({ error: ctx.t('teamNotFound') }, { status: 404 })
  try {
    if (!(await canAccessConversation(ctx.db, ctx.userId, target.data))) return NextResponse.json({ error: ctx.t('teamNotFound') }, { status: 404 })
  } catch (error) { return serverError(error, ctx.t('teamFailed')) }
  const [sourceId, targetId] = [ctx.source.id, body.target_id].sort()
  const result = await ctx.db.from('conversation_links').insert({ workspace_id: ctx.workspaceId,
    source_conversation_id: sourceId, target_conversation_id: targetId, linked_by: ctx.userId })
  if (result.error && result.error.code !== '23505') return serverError(result.error, ctx.t('teamFailed'))
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, route: RouteContext) {
  const blocked = await csrfGuard(request)
  if (blocked) return blocked
  const ctx = await context(route)
  if (ctx.response) return ctx.response
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  const link = await ctx.db.from('conversation_links').select('source_conversation_id,target_conversation_id')
    .eq('workspace_id', ctx.workspaceId).eq('id', id).is('unlinked_at', null)
    .or(`source_conversation_id.eq.${ctx.source.id},target_conversation_id.eq.${ctx.source.id}`).maybeSingle()
  if (link.error) return serverError(link.error, ctx.t('teamFailed'))
  if (!link.data) return NextResponse.json({ error: ctx.t('teamNotFound') }, { status: 404 })
  const targetId = link.data.source_conversation_id === ctx.source.id ? link.data.target_conversation_id : link.data.source_conversation_id
  const target = await ctx.db.from('conversations').select('channel,connection_id').eq('workspace_id', ctx.workspaceId)
    .eq('id', targetId).is('deleted_at', null).maybeSingle()
  if (target.error) return serverError(target.error, ctx.t('teamFailed'))
  try {
    if (!target.data || !(await canAccessConversation(ctx.db, ctx.userId, target.data))) return NextResponse.json({ error: ctx.t('teamNotFound') }, { status: 404 })
  } catch (error) { return serverError(error, ctx.t('teamFailed')) }
  const result = await ctx.db.from('conversation_links').update({ unlinked_at: new Date().toISOString(), unlinked_by: ctx.userId })
    .eq('workspace_id', ctx.workspaceId).eq('id', id).is('unlinked_at', null)
    .or(`source_conversation_id.eq.${ctx.source.id},target_conversation_id.eq.${ctx.source.id}`).select('id').maybeSingle()
  if (result.error) return serverError(result.error, ctx.t('teamFailed'))
  if (!result.data) return NextResponse.json({ error: ctx.t('teamNotFound') }, { status: 404 })
  return NextResponse.json({ ok: true })
}
