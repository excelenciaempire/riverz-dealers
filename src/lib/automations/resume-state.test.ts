/* eslint-disable @typescript-eslint/no-explicit-any -- Heterogeneous in-memory Supabase rows and its fluent thenable test double. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/billing/read-only', () => ({ workspaceReadOnly: async () => false }))

const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, reads: [] as string[] }))
vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({ from: (table: string) => {
  const filters: Array<(row: any) => boolean> = []
  let operation = 'select', payload: any, count = false, single = false
  const query: any = {
    select: (_?: string, options?: any) => { count = !!options?.count; return query },
    eq: (key: string, value: any) => { filters.push(r => r[key] === value); return query },
    is: (key: string, value: any) => { filters.push(r => (r[key] ?? null) === value); return query },
    in: (key: string, value: any[]) => { filters.push(r => value.includes(r[key])); return query },
    gte: (key: string, value: number) => { filters.push(r => r[key] >= value); return query },
    order: () => query,
    single: () => { single = true; return query },
    update: (value: any) => { operation = 'update'; payload = value; return query },
    insert: (value: any) => { operation = 'insert'; payload = value; return query },
    then: (resolve: any, reject: any) => Promise.resolve().then(() => {
      state.reads.push(table)
      const rows = state.tables[table]
      if (!rows) throw Error(`Unexpected table ${table}`)
      if (operation === 'insert') rows.push({ id: `new-${rows.length}`, ...payload })
      const found = rows.filter(r => filters.every(f => f(r)))
      if (operation === 'update') found.forEach(r => Object.assign(r, payload))
      return { data: single ? found[0] : found, error: null, count: count ? found.length : null }
    }).then(resolve, reject),
  }
  return query
} }) }))
vi.mock('@/lib/workspaces/owner', () => ({ resolveWorkspaceOwnerUserId: async () => 'owner' }))
vi.mock('./meta-send', () => ({ engineSendText: vi.fn(), engineSendTemplate: vi.fn() }))

import { cancelPendingAutomationsOnInbound, cancelPendingByTrigger, resumePendingExecution } from './engine'
import { supabaseAdmin } from './admin-client'

const pending = { id: 'pending', automation_id: 'a', workspace_id: 'w', contact_id: 'c', log_id: 'log',
  parent_step_id: null, branch: null, next_step_position: 0, context: { vars: { selected: 'yes' } } }

beforeEach(() => {
  state.reads = []
  state.tables = {
    automations: [{ id: 'a', workspace_id: 'w', is_active: true, activation_state: 'active', trigger_config: {} }],
    automation_pending_executions: [{ ...pending, status: 'running', run_at: '2026-09-14T19:00:00Z' }],
    automation_logs: [{ id: 'log', status: 'partial', steps_executed: [] }],
    automation_steps: [],
  }
})

describe('real engine continuation', () => {
  it('settles an inbound cancellation without leaving an orphan wait alarm', async () => {
    state.tables.automations[0].trigger_config = { stop_on_inbound: true }
    Object.assign(state.tables.automation_pending_executions[0], { status: 'pending' })
    await cancelPendingAutomationsOnInbound({ workspaceId: 'w', contactId: 'c', conversationId: 'cv', messageText: 'Gracias' })
    expect(state.tables.automation_pending_executions[0].status).toBe('done')
    expect(state.tables.automation_logs[0]).toMatchObject({ status: 'success', steps_executed: [
      { status: 'skipped', detail: 'cancelled by inbound reply' },
    ] })
    expect(state.reads).not.toContain('automation_steps')
  })
  it('settles a cart reminder cancelled by purchase without sending or replaying', async () => {
    Object.assign(state.tables.automations[0], { trigger_type: 'shopify_abandoned_checkout' })
    Object.assign(state.tables.automation_pending_executions[0], { status: 'pending' })
    await cancelPendingByTrigger(supabaseAdmin(), 'w', 'c', 'shopify_abandoned_checkout')
    expect(state.tables.automation_pending_executions[0].status).toBe('done')
    expect(state.tables.automation_logs[0]).toMatchObject({ status: 'success', steps_executed: [
      { status: 'skipped', detail: 'cancelled by purchase' },
    ] })
    expect(state.reads).not.toContain('automation_steps')
  })
  it('does not cancel a running reminder or overwrite a previous failure', async () => {
    Object.assign(state.tables.automations[0], { trigger_type: 'shopify_abandoned_checkout' })
    await cancelPendingByTrigger(supabaseAdmin(), 'w', 'c', 'shopify_abandoned_checkout')
    expect(state.tables.automation_pending_executions[0].status).toBe('running')
    expect(state.tables.automation_logs[0].status).toBe('partial')
    Object.assign(state.tables.automation_pending_executions[0], { status: 'pending' })
    state.tables.automation_logs[0].status = 'failed'
    await cancelPendingByTrigger(supabaseAdmin(), 'w', 'c', 'shopify_abandoned_checkout')
    expect(state.tables.automation_logs[0].status).toBe('failed')
  })
  it.each([{ is_active: false }, { activation_state: 'draft' }, { deleted_at: '2026-09-14' }])(
    'releases a claimed wait without executing or changing its date when unavailable: %j', async patch => {
      Object.assign(state.tables.automations[0], patch)
      await resumePendingExecution(pending)
      expect(state.reads).not.toContain('automation_steps')
      expect(state.tables.automation_pending_executions[0]).toMatchObject({ status: 'pending', run_at: '2026-09-14T19:00:00Z', next_step_position: 0 })
      expect(state.tables.automation_logs[0].steps_executed).toEqual([])
    },
  )
  it('records the condition before its nested wait and leaves the run waiting', async () => {
    state.tables.automation_steps = [
      { id: 'cond', automation_id: 'a', parent_step_id: null, position: 0, step_type: 'condition', step_config: { subject: 'context_var', operand: 'selected', op: 'eq', value: 'yes' } },
      { id: 'wait', automation_id: 'a', parent_step_id: 'cond', branch: 'yes', position: 0, step_type: 'wait', step_config: { amount: 6, unit: 'days' } },
    ]
    await resumePendingExecution(pending)
    expect(state.tables.automation_logs[0].status).toBe('partial')
    expect(state.tables.automation_logs[0].steps_executed.map((s: any) => s.step_type)).toEqual(['condition', 'wait'])
    expect(state.tables.automation_pending_executions.map(p => p.status)).toEqual(['done', 'pending'])
  })
  it('does not turn a deleted-path failure into success when the claim settles', async () => {
    await resumePendingExecution({ ...pending, branch: 'yes' })
    expect(state.tables.automation_logs[0].status).toBe('failed')
    expect(state.tables.automation_logs[0].error_message).toContain('ya no existe')
  })
})
