import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { csrfGuard } from '@/lib/csrf'
import { serverError } from '@/lib/api/errors'
import { UUID } from '@/lib/inbox/collaboration'
import { inboxSession } from '@/lib/inbox/server-context'

export async function GET() {
  const ctx = await inboxSession()
  if (ctx.response) return ctx.response
  const [teams, states, membership, load] = await Promise.all([
    ctx.client.from('inbox_teams').select('id,name,enabled').eq('workspace_id', ctx.workspaceId).order('name'),
    ctx.client.from('inbox_agent_state').select('user_id,enabled,available,capacity').eq('workspace_id', ctx.workspaceId),
    ctx.client.from('workspace_members').select('user_id,role').eq('workspace_id', ctx.workspaceId),
    ctx.db.rpc('inbox_member_load', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.userId }),
  ])
  const error = teams.error ?? states.error ?? membership.error ?? load.error
  if (error) return serverError(error, ctx.t('teamFailed'))
  const ids = (membership.data ?? []).map(m => m.user_id)
  const teamIds = (teams.data ?? []).map(g => g.id)
  const [profiles, teamMembers] = await Promise.all([
    ids.length ? ctx.db.from('profiles').select('user_id,full_name').in('user_id', ids) : { data: [], error: null },
    teamIds.length ? ctx.client.from('inbox_team_members').select('team_id,user_id').in('team_id', teamIds) : { data: [], error: null },
  ])
  if (profiles.error || teamMembers.error) return serverError(profiles.error ?? teamMembers.error, ctx.t('teamFailed'))
  const members = (membership.data ?? []).map(m => ({ id: m.user_id,
    name: profiles.data?.find(p => p.user_id === m.user_id)?.full_name ?? ctx.t('teamMember'),
    available: states.data?.find(s => s.user_id === m.user_id)?.available ?? true,
    enabled: states.data?.find(s => s.user_id === m.user_id)?.enabled ?? true,
    capacity: states.data?.find(s => s.user_id === m.user_id)?.capacity ?? 20,
    active: (load.data as { user_id: string; active: number }[] | null)?.find(s => s.user_id === m.user_id)?.active ?? 0,
  }))
  return NextResponse.json({ members, teams: (teams.data ?? []).map(g => ({ ...g, member_ids: (teamMembers.data ?? []).filter(m => m.team_id === g.id).map(m => m.user_id) })),
    user_id: ctx.userId, is_admin: ctx.isAdmin }, { headers: { 'Cache-Control': 'private, no-store' } })
}
export async function POST(request: Request) {
  const block = await csrfGuard(request)
  if (block) return block
  const ctx = await inboxSession()
  if (ctx.response) return ctx.response
  const b = await request.json().catch(() => null)
  if (!b || Array.isArray(b)) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  if (b.action === 'state') {
    if (Object.keys(b).some(k => !['action', 'user_id', 'available', 'enabled', 'capacity'].includes(k)) || !UUID.test(b.user_id ?? '') ||
      (b.available !== undefined && typeof b.available !== 'boolean') || (b.enabled !== undefined && typeof b.enabled !== 'boolean') ||
      (b.capacity !== undefined && (!Number.isInteger(b.capacity) || b.capacity < 1 || b.capacity > 500)) ||
      [b.available, b.enabled, b.capacity].every(value => value === undefined)) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
    if (!ctx.isAdmin && (b.user_id !== ctx.userId || b.enabled !== undefined || b.capacity !== undefined)) return NextResponse.json({ error: ctx.t('teamAdminsOnly') }, { status: 403 })
    const result = await ctx.db.rpc('update_inbox_agent_state', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.userId, p_user_id: b.user_id,
      p_available: b.available ?? null, p_enabled: b.enabled ?? null, p_capacity: b.capacity ?? null })
    if (result.error) return serverError(result.error, ctx.t('teamFailed'))
    return NextResponse.json({ ok: true })
  }
  if (!ctx.isAdmin) return NextResponse.json({ error: ctx.t('teamAdminsOnly') }, { status: 403 })
  if (b.action !== 'team' || Object.keys(b).some(k => !['action', 'id', 'name', 'enabled', 'member_ids'].includes(k)) ||
    (b.id !== undefined && !UUID.test(b.id)) || typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 80 || typeof b.enabled !== 'boolean' ||
    !Array.isArray(b.member_ids) || b.member_ids.length > 100 || !b.member_ids.every((id: unknown) => typeof id === 'string' && UUID.test(id))) return NextResponse.json({ error: ctx.t('teamInvalid') }, { status: 400 })
  if (!b.id) {
    const quota = await ctx.db.from('inbox_teams').select('id', { count: 'exact', head: true }).eq('workspace_id', ctx.workspaceId)
    if (quota.error) return serverError(quota.error, ctx.t('teamFailed'))
    if ((quota.count ?? 0) >= 50) return NextResponse.json({ error: ctx.t('teamGroupLimit') }, { status: 409 })
  }
  const result = await ctx.db.rpc('configure_inbox_team', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.userId,
    p_id: b.id ?? randomUUID(), p_name: b.name.trim(), p_enabled: b.enabled, p_members: [...new Set(b.member_ids)] })
  if (result.error) return serverError(result.error, ctx.t('teamFailed'))
  return NextResponse.json({ id: result.data })
}
