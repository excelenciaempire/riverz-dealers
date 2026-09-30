import type { SupabaseClient } from '@supabase/supabase-js'

interface RuleRow {
  id: string
  kind: 'round_robin' | 'by_tag' | 'by_channel' | 'by_keyword'
  channel: string | null
  config: { channel?: string; keyword?: string; tag_id?: string; agent_id?: string; agent_ids?: string[]; team_id?: string }
}

/** Membership, availability, capacity and concurrent load are checked in one transaction. */
export async function assignInboxConversation(admin: SupabaseClient, args: {
  workspaceId: string; conversationId: string; agentIds?: string[]; teamId?: string
  actorId?: string; replace?: boolean
}): Promise<string | null> {
  if (!args.conversationId) throw new Error('assignment requires an existing conversation')
  const { data, error } = await admin.rpc('assign_inbox_case', {
    p_workspace_id: args.workspaceId, p_conversation_id: args.conversationId,
    p_actor_id: args.actorId ?? null, p_candidates: args.agentIds ?? null,
    p_team_id: args.teamId ?? null, p_replace: args.replace ?? false,
  })
  if (error) throw new Error(error.message)
  if (data?.outcome === 'waiting') return null
  if (typeof data?.agent_id !== 'string') throw new Error('invalid assignment result')
  return data.agent_id
}

export async function resolveAssignmentForConversation(admin: SupabaseClient, args: {
  workspaceId: string; conversationId: string; channel: string; contactId: string; firstMessageText?: string
}): Promise<string | null> {
  const { data: rules, error } = await admin.from('conversation_assignment_rules')
    .select('id, kind, channel, config').eq('workspace_id', args.workspaceId)
    .eq('is_active', true).order('priority', { ascending: true })
  if (error) throw new Error(error.message)
  if (!rules?.length) return null
  const tags = new Set<string>()
  if ((rules as RuleRow[]).some(rule => rule.kind === 'by_tag')) {
    const { data, error: tagError } = await admin.from('contact_tags').select('tag_id').eq('contact_id', args.contactId)
    if (tagError) throw new Error(tagError.message)
    for (const row of data ?? []) tags.add(row.tag_id)
  }
  for (const rule of rules as RuleRow[]) {
    if (rule.channel && rule.channel !== args.channel) continue
    const cfg = rule.config
    const matched = rule.kind === 'round_robin'
      || (rule.kind === 'by_channel' && cfg.channel === args.channel)
      || (rule.kind === 'by_tag' && !!cfg.tag_id && tags.has(cfg.tag_id))
      || (rule.kind === 'by_keyword' && !!cfg.keyword && (args.firstMessageText ?? '').toLowerCase().includes(cfg.keyword.toLowerCase()))
    if (!matched) continue
    const agentIds = rule.kind === 'round_robin' ? cfg.agent_ids : cfg.agent_id ? [cfg.agent_id] : []
    if (!cfg.team_id && !agentIds?.length) continue
    // A matched rule owns the queue even if nobody can take it now.
    return assignInboxConversation(admin, { ...args, agentIds: cfg.team_id ? undefined : agentIds, teamId: cfg.team_id })
  }
  return null
}
