import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assignInboxConversation, resolveAssignmentForConversation } from './assignment-rules'

const args = { workspaceId: 'ws', conversationId: 'conv', channel: 'whatsapp', contactId: 'contact', firstMessageText: 'Entrega' }
function client(rules: unknown[] = [], outcome = 'assigned', error: { message: string } | null = null) {
  const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: { agent_id: outcome === 'waiting' ? null : 'agent', outcome }, error }))
  const query = { select: () => query, eq: () => query, order: async () => ({ data: rules, error: null }) }
  return { db: { from: () => query, rpc } as unknown as SupabaseClient, rpc }
}
describe('capacity-aware assignment integration', () => {
  it('uses the real persisted case and trusted workspace; database decides capacity', async () => {
    const { db, rpc } = client()
    expect(await assignInboxConversation(db, { ...args, agentIds: ['agent'] })).toBe('agent')
    expect(rpc).toHaveBeenCalledWith('assign_inbox_case', { p_workspace_id: 'ws', p_conversation_id: 'conv', p_actor_id: null, p_candidates: ['agent'], p_team_id: null, p_replace: false })
    await expect(assignInboxConversation(db, { ...args, conversationId: '' })).rejects.toThrow('existing conversation')
  })
  it('does not fall through a matched unavailable team to another rule', async () => {
    const { db, rpc } = client([
      { kind: 'by_keyword', channel: null, config: { keyword: 'entrega', team_id: 'team' } },
      { kind: 'round_robin', channel: null, config: { agent_ids: ['other'] } },
    ], 'waiting')
    expect(await resolveAssignmentForConversation(db, args)).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0]).toEqual(['assign_inbox_case', expect.objectContaining({ p_team_id: 'team', p_candidates: null })])
  })
  it('preserves channel matching and candidate boundaries without local round-robin state', async () => {
    const { db, rpc } = client([
      { kind: 'round_robin', channel: 'instagram', config: { agent_ids: ['wrong'] } },
      { kind: 'round_robin', channel: null, config: { agent_ids: ['one', 'two'] } },
    ])
    await resolveAssignmentForConversation(db, args)
    expect(rpc.mock.calls[0]).toEqual(['assign_inbox_case', expect.objectContaining({ p_candidates: ['one', 'two'] })])
  })
  it('surfaces assignment errors so the inbound caller can retain an unassigned case', async () => {
    const { db } = client([], 'assigned', { message: 'database unavailable' })
    await expect(assignInboxConversation(db, args)).rejects.toThrow('database unavailable')
  })
})
