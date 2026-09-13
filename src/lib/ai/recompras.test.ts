import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { gestionarRecompra } from './recompras'

function fixture(overrides: Record<string, unknown> = {}) {
  const queries: Array<{ table: string; op: string; filters: Record<string, unknown>; payload?: Record<string, unknown> }> = []
  const values: Record<string, unknown> = {
    conversations: { automation_context: { retention_handoff: { automation_id: 'a', pending_id: 'p', token: 't' } } },
    automations: { id: 'a', is_active: true, trigger_config: { retention_ai_managed: true, retention_permission_tag: 'tag' } },
    automation_pending_executions: { id: 'p', automation_id: 'a', context: { vars: { retention_pause_token: 't' } } },
    tags: { id: 'tag' }, contact_tags: { contact_id: 'c' }, ...overrides,
  }
  const db = { from(table: string) {
    const q = { table, op: 'read', filters: {} as Record<string, unknown>, payload: undefined as Record<string, unknown> | undefined }; queries.push(q)
    const result = () => ({ error: null, data: q.op === 'update' ? [{ id: 'p' }] : values[table] })
    const chain = { select: () => chain,
      eq: (key: string, v: unknown) => { q.filters[key] = v; return chain },
      is: (key: string, v: unknown) => { q.filters[key] = v; return chain },
      update: (payload: Record<string, unknown>) => { q.op = 'update'; q.payload = payload; return chain },
      delete: () => { q.op = 'delete'; return chain }, maybeSingle: async () => result(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }; return chain
  } } as unknown as SupabaseClient
  return { queries, ctx: { db, workspaceId: 'w', contactId: 'c', conversationId: 'chat' } }
}
describe('AI controls only the current customer reorder follow-up', () => {
  it('reschedules a paused run without changing its steps and consumes its token', async () => {
    const { ctx, queries } = fixture()
    expect(JSON.parse(await gestionarRecompra(ctx, { accion: 'reprogramar', dias: 15, confirmado: true })).ok).toBe(true)
    const update = queries.find(q => q.op === 'update')!
    expect(update.filters).toMatchObject({ workspace_id: 'w', contact_id: 'c', id: 'p', status: 'done', 'context->vars->>retention_pause_token': 't' })
    expect(update.payload).toMatchObject({ status: 'pending', context: { vars: { retention_pause_token: null } } })
    expect(update.payload).not.toHaveProperty('parent_step_id')
  })
  it('rejects rescheduling without explicit days or confirmation before any database work', async () => {
    const { ctx, queries } = fixture()
    for (const days of [0, -1, 1.5, 366]) expect(JSON.parse(await gestionarRecompra(ctx, { accion: 'reprogramar', dias: days, confirmado: true })).ok).toBe(false)
    expect(JSON.parse(await gestionarRecompra(ctx, { accion: 'reprogramar', dias: 15 })).ok).toBe(false)
    expect(queries).toEqual([])
  })
  it.each(['conversations', 'automations', 'automation_pending_executions', 'contact_tags'])('fails closed when %s is unavailable in the scoped lookup', async table => {
    const { ctx, queries } = fixture({ [table]: null })
    expect(JSON.parse(await gestionarRecompra(ctx, { accion: 'reprogramar', dias: 15, confirmado: true })).ok).toBe(false)
    expect(queries.some(q => q.op === 'update')).toBe(false)
  })
  it('cancels even after the last reminder and only removes this program permission', async () => {
    const { ctx, queries } = fixture({ conversations: { automation_context: { retention_handoff: { automation_id: 'a' } } } })
    expect(JSON.parse(await gestionarRecompra(ctx, { accion: 'cancelar' })).ok).toBe(true)
    expect(queries.find(q => q.op === 'delete')?.filters).toEqual({ contact_id: 'c', tag_id: 'tag' })
    expect(queries.find(q => q.table === 'tags')?.filters.workspace_id).toBe('w')
  })
})
