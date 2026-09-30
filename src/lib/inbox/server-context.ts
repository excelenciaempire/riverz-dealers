import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLocale } from '@/lib/i18n/server'
import { translate, type TVars } from '@/lib/i18n/translate'
import { serverError } from '@/lib/api/errors'
import { canAccessConversation } from './access'
import { UUID } from './collaboration'

export async function inboxSession() {
  const locale = await getLocale()
  const t = (key: string, vars?: TVars) => translate(locale, `inbox.${key}`, vars)
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: t('teamUnauthorized') }, { status: 401 }) }
  const workspaceId = await resolveWorkspaceIdForUser(client, user.id)
  if (!workspaceId) return { response: NextResponse.json({ error: t('teamNotFound') }, { status: 404 }) }
  const member = await client.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle()
  if (member.error) return { response: serverError(member.error, t('teamFailed')) }
  if (!member.data) return { response: NextResponse.json({ error: t('teamUnauthorized') }, { status: 403 }) }
  return { db: supabaseAdmin(), client, userId: user.id, workspaceId, t, isAdmin: ['admin', 'owner'].includes(member.data.role) }
}

export async function inboxConversation(id: string) {
  const ctx = await inboxSession()
  if (ctx.response) return ctx
  if (!UUID.test(id)) return { response: NextResponse.json({ error: ctx.t('teamNotFound') }, { status: 404 }) }
  const conversation = await ctx.db.from('conversations').select('*').eq('workspace_id', ctx.workspaceId).eq('id', id).is('deleted_at', null).maybeSingle()
  if (conversation.error) return { response: serverError(conversation.error, ctx.t('teamFailed')) }
  try {
    if (!conversation.data || !(await canAccessConversation(ctx.db, ctx.userId, conversation.data))) return { response: NextResponse.json({ error: ctx.t('teamNotFound') }, { status: 404 }) }
  } catch (error) { return { response: serverError(error, ctx.t('teamFailed')) } }
  return { ...ctx, conversation: conversation.data }
}

export function inboxActionError(error: { message: string }, t: (key: string) => string) {
  const code = ['inbox_macro_changed', 'inbox_operation_conflict', 'inbox_team_unavailable', 'invalid_reminder_context'].find(value => error.message.includes(value))
  const key = code === 'inbox_macro_changed' ? 'macroChanged' : code === 'inbox_team_unavailable' ? 'teamUnavailable' : code ? 'actionConflict' : 'teamFailed'
  return code ? NextResponse.json({ error: t(key) }, { status: 409 }) : serverError(error, t(key))
}
