import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { collaborationAction, noteCursor, UUID } from '@/lib/inbox/collaboration'
import { canAccessConversation, PERSONAL_EMAIL_CHANNELS } from '@/lib/inbox/access'

type RouteContext = { params: Promise<{ id: string }> }
async function context(route: RouteContext) {
  const locale = await getLocale()
  const t = (key: string) => translate(locale, `inbox.${key}`)
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: t('teamUnauthorized') }, { status: 401 }) }
  const workspaceId = await resolveWorkspaceIdForUser(client, user.id)
  const { id } = await route.params
  if (!workspaceId || !UUID.test(id)) return { response: NextResponse.json({ error: t('teamNotFound') }, { status: 404 }) }
  const db = supabaseAdmin()
  const conversation = await db.from('conversations').select('id,channel,connection_id,case_priority,case_reason').eq('id', id).eq('workspace_id', workspaceId).is('deleted_at', null).maybeSingle()
  if (conversation.error) return { response: serverError(conversation.error, t('teamFailed')) }
  if (!conversation.data) return { response: NextResponse.json({ error: t('teamNotFound') }, { status: 404 }) }
  try {
    if (!(await canAccessConversation(db, user.id, conversation.data))) return { response: NextResponse.json({ error: t('teamNotFound') }, { status: 404 }) }
  } catch (error) { return { response: serverError(error, t('teamFailed')) } }
  return { db, userId: user.id, workspaceId, conversationId: id, conversation: conversation.data, t }
}

export async function GET(request: Request, route: RouteContext) {
  const ctx = await context(route)
  if (ctx.response) return ctx.response
  const rawCursor = new URL(request.url).searchParams.get('before')
  const cursor = noteCursor(rawCursor)
  if (rawCursor && !cursor) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  let notesQuery = ctx.db.from('conversation_notes').select('id,body,author_id,created_at,mentioned_user_ids')
    .eq('workspace_id', ctx.workspaceId).eq('conversation_id', ctx.conversationId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(51)
  if (cursor) notesQuery = notesQuery.or(`created_at.lt.${cursor.date},and(created_at.eq.${cursor.date},id.lt.${cursor.id})`)
  const [notes, memberships, presence] = await Promise.all([
    notesQuery,
    ctx.db.from('workspace_members').select('user_id').eq('workspace_id', ctx.workspaceId),
    ctx.db.from('conversation_presence').select('user_id,composing').eq('workspace_id', ctx.workspaceId)
      .eq('conversation_id', ctx.conversationId).gt('expires_at', new Date().toISOString()),
  ])
  const error = notes.error ?? memberships.error ?? presence.error
  if (error) return serverError(error, ctx.t('teamFailed'))
  const ids = [...new Set([...(memberships.data ?? []).map(m => String(m.user_id)), ...(notes.data ?? []).map(n => String(n.author_id)).filter(id => id !== 'null')])]
  const profiles = ids.length ? await ctx.db.from('profiles').select('user_id,full_name').in('user_id', ids) : { data: [], error: null }
  if (profiles.error) return serverError(profiles.error, ctx.t('teamFailed'))
  const names = new Map((profiles.data ?? []).map(p => [String(p.user_id), p.full_name || ctx.t('teamMember')]))
  const members = (memberships.data ?? []).filter(m => !(PERSONAL_EMAIL_CHANNELS as readonly string[]).includes(ctx.conversation.channel) || m.user_id === ctx.userId)
    .map(m => ({ id: String(m.user_id), name: names.get(String(m.user_id)) ?? ctx.t('teamMember') }))
  const activeMembers = new Set(members.map(m => m.id))
  const observers = new Map<string, { id: string; name: string; composing: boolean }>()
  for (const p of presence.data ?? []) {
    const id = String(p.user_id)
    if (id === ctx.userId || !activeMembers.has(id)) continue
    observers.set(id, { id, name: names.get(id) ?? ctx.t('teamMember'), composing: p.composing || observers.get(id)?.composing || false })
  }
  const page = (notes.data ?? []).slice(0, 50)
  const last = page[page.length - 1]
  return NextResponse.json({
    user_id: ctx.userId, members, presence: [...observers.values()], case: ctx.conversation,
    notes: page.map(n => ({ ...n, author_name: names.get(String(n.author_id)) ?? ctx.t('teamMember') })).reverse(),
    next_cursor: (notes.data?.length ?? 0) > 50 && last ? `${last.created_at}|${last.id}` : null,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request, route: RouteContext) {
  const blocked = await csrfGuard(request)
  if (blocked) return blocked
  const ctx = await context(route)
  if (ctx.response) return ctx.response
  const action = collaborationAction(await request.json().catch(() => null))
  if (!action) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  if (action.action === 'note') {
    const result = await ctx.db.rpc('add_conversation_note', { p_id: action.id, p_workspace_id: ctx.workspaceId,
      p_conversation_id: ctx.conversationId, p_author_id: ctx.userId, p_body: action.body, p_mentions: action.mentions })
    if (result.error) {
      if (/invalid_note_context|note_id_conflict/.test(result.error.message)) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 409 })
      return serverError(result.error, ctx.t('teamFailed'))
    }
    return NextResponse.json({ id: result.data }, { status: 201 })
  }
  if (action.action === 'presence') {
    const result = await ctx.db.rpc('update_conversation_presence', {
      p_workspace_id: ctx.workspaceId, p_conversation_id: ctx.conversationId, p_user_id: ctx.userId,
      p_session_id: action.session_id, p_composing: action.composing, p_version: action.version,
    })
    if (result.error) return serverError(result.error, ctx.t('teamFailed'))
  } else {
    const result = await ctx.db.from('conversations').update({ case_priority: action.priority, case_reason: action.reason })
      .eq('workspace_id', ctx.workspaceId).eq('id', ctx.conversationId)
    if (result.error) return serverError(result.error, ctx.t('teamFailed'))
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, route: RouteContext) {
  const blocked = await csrfGuard(request)
  if (blocked) return blocked
  const ctx = await context(route)
  if (ctx.response) return ctx.response
  const sessionId = new URL(request.url).searchParams.get('session_id') ?? ''
  if (!UUID.test(sessionId)) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  const removed = await ctx.db.from('conversation_presence').delete().eq('workspace_id', ctx.workspaceId)
    .eq('conversation_id', ctx.conversationId).eq('user_id', ctx.userId).eq('session_id', sessionId)
  if (removed.error) return serverError(removed.error, ctx.t('teamFailed'))
  return NextResponse.json({ ok: true })
}
