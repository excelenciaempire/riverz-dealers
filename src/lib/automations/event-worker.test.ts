import { beforeEach, describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => vi.fn())
vi.mock('./engine', () => ({ runAutomationById: run }))
import { drainAutomationEvents } from './event-worker'
import type { SupabaseClient } from '@supabase/supabase-js'

beforeEach(() => run.mockReset())
function client(log: { status: string } | null) {
  const update = vi.fn()
  const event = { id: 'event-id', automation_id: 'rule-id', workspace_id: 'workspace-id', contact_id: 'contact-id', event_type: 'tag_added', context: { tag_id: 'tag-id' } }
  const query = { eq: () => query, then: (resolve: (result: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) }
  const db = { rpc: vi.fn().mockResolvedValue({ data: [event], error: null }), from: (table: string) => table === 'automation_logs'
    ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: log, error: null }) }) }) }) }
    : { update: (data: unknown) => { update(data); return query } } } as unknown as SupabaseClient
  return { db, update }
}
describe('event worker outcome', () => {
  it('keeps an execution failure visible and does not call the motor twice', async () => {
    run.mockResolvedValue({ executed: true })
    const { db, update } = client({ status: 'failed' })
    expect(await drainAutomationEvents(db)).toEqual({ processed: 1, failed: 1 })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', reason: 'step_failed' }))
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace-id', eventType: 'tag_added', context: { tag_id: 'tag-id', event_id: 'event-id' } }))
  })
  it('records a guard that produced no run as skipped', async () => {
    run.mockResolvedValue({ executed: true })
    const { db, update } = client(null)
    await drainAutomationEvents(db)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', reason: 'execution_guard' }))
  })
  it('records an accepted run without discarding its step log', async () => {
    run.mockResolvedValue({ executed: true })
    const { db, update } = client({ status: 'success' })
    expect(await drainAutomationEvents(db)).toEqual({ processed: 1, failed: 0 })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', reason: null }))
  })
})
