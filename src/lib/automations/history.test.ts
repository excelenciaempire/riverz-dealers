/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory Supabase query double. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAutomationHistory } from './history'
import { automationHistoryId, historyCursor, parseHistoryQuery } from './history-query'

const auto = '11111111-1111-4111-8111-111111111111'
const contact = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`
const timestamp = '2026-10-01T03:00:00.123456Z'
let tables: Record<string, any[]>, calls: any[], failing: string | null
function db(): SupabaseClient {
  return { from(table: string) {
    const predicates: Array<(row: any) => boolean> = [], orders: string[] = []
    let maximum = Infinity, one = false
    const q: any = {
      select: (...args: any[]) => { calls.push([table, 'select', ...args]); return q },
      eq: (key: string, value: any) => { calls.push([table, 'eq', key, value]); predicates.push(row => row[key] === value); return q },
      is: (key: string, value: any) => { predicates.push(row => (row[key] ?? null) === value); return q },
      in: (key: string, values: any[]) => { predicates.push(row => values.includes(row[key])); return q },
      gte: (key: string, value: string) => { predicates.push(row => row[key] >= value); return q },
      lte: (key: string, value: string) => { predicates.push(row => row[key] <= value); return q },
      order: (key: string) => { orders.push(key); return q },
      limit: (n: number) => { maximum = n; return q },
      or: (expression: string) => {
        calls.push([table, 'or', expression])
        const match = /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.(.+)\)$/.exec(expression)
        if (!match) throw new Error('Unexpected cursor expression')
        predicates.push(row => row.created_at < match[1] || (row.created_at === match[2] && row.id < match[3]))
        return q
      },
      maybeSingle: () => { one = true; return q },
      then: (resolve: any, reject: any) => Promise.resolve().then(() => {
        const rows = (tables[table] ?? []).filter(row => predicates.every(test => test(row)))
          .sort((a, b) => { for (const key of orders) { if (a[key] !== b[key]) return a[key] < b[key] ? 1 : -1 } return 0 }).slice(0, maximum)
        return { data: one ? structuredClone(rows[0] ?? null) : structuredClone(rows), error: table === failing ? { message: 'private_database_details' } : null }
      }).then(resolve, reject),
    }
    return q
  } } as unknown as SupabaseClient
}
const row = (n: number, overrides: Record<string, unknown> = {}) => ({ id: id(n), automation_id: auto, workspace_id: 'w', created_at: timestamp, status: 'success', contact_id: contact, contact: { id: contact, name: 'Ana', phone: '573000000000' }, steps_executed: [], ...overrides })
beforeEach(() => {
  tables = { automations: [{ id: auto, short_id: '11111111', workspace_id: 'w', name: 'Flow', deleted_at: null }], contacts: [{ id: contact, workspace_id: 'w' }], automation_logs: [row(1), row(2), row(3)] }
  calls = []; failing = null
})

describe('existing automation history, paged without effects', () => {
  it('resolves short IDs within the workspace before reading logs', async () => {
    const page = await loadAutomationHistory(db(), 'w', '11111111', parseHistoryQuery({}))
    expect(page.automation.id).toBe(auto)
    expect(calls).toContainEqual(['automations', 'eq', 'workspace_id', 'w'])
    expect(calls).toContainEqual(['automations', 'eq', 'short_id', '11111111'])
    expect(calls).toContainEqual(['automation_logs', 'eq', 'workspace_id', 'w'])
    expect(calls).toContainEqual(['automation_logs', 'eq', 'automation_id', auto])
  })
  it('rejects another workspace or a deleted automation before reading any log', async () => {
    await expect(loadAutomationHistory(db(), 'other', auto, parseHistoryQuery({}))).rejects.toThrow('not_found')
    expect(calls.some(call => call[0] === 'automation_logs')).toBe(false)
    tables.automations[0].deleted_at = timestamp
    await expect(loadAutomationHistory(db(), 'w', auto, parseHistoryQuery({}))).rejects.toThrow('not_found')
  })
  it('uses both timestamp and UUID to avoid losing rows with identical timestamps', async () => {
    const first = await loadAutomationHistory(db(), 'w', auto, parseHistoryQuery({ limit: 2 }))
    expect(first.logs.map(log => log.id)).toEqual([id(3), id(2)])
    expect(first.next_cursor).toContain('.123456Z')
    tables.automation_logs.push(row(4, { created_at: '2026-10-01T03:01:00Z' }))
    const second = await loadAutomationHistory(db(), 'w', auto, parseHistoryQuery({ limit: 2, cursor: first.next_cursor! }))
    expect(second.logs.map(log => log.id)).toEqual([id(1)])
    expect(second.next_cursor).toBeNull()
  })
  it('applies contact, status and inclusive time filters on the same workspace', async () => {
    tables.automation_logs.push(row(4, { status: 'failed' }), row(5, { status: 'failed', contact_id: id(8) }), row(6, { status: 'failed', workspace_id: 'other' }), row(7, { status: 'failed', automation_id: id(9) }), row(8, { status: 'failed', created_at: '2026-10-01T04:00:00Z' }))
    const page = await loadAutomationHistory(db(), 'w', auto, parseHistoryQuery({ contact_id: contact, status: 'failed', from: timestamp, to: timestamp }))
    expect(page.logs.map(log => log.id)).toEqual([id(4)])
  })
  it('loads an exact older deep link separately instead of requiring it in the latest page', async () => {
    const page = await loadAutomationHistory(db(), 'w', auto, parseHistoryQuery({ limit: 1, log: id(1) }))
    expect(page.logs.map(log => log.id)).toEqual([id(3)])
    expect(page.linked_log?.id).toBe(id(1))
    tables.automation_logs[0].workspace_id = 'other'
    const foreign = await loadAutomationHistory(db(), 'w', auto, parseHistoryQuery({ limit: 1, log: id(1) }))
    expect(foreign.linked_log).toBeNull()
  })
  it('does not pin a linked row outside the requested filters or fetch it again on later pages', async () => {
    const page = await loadAutomationHistory(db(), 'w', auto, parseHistoryQuery({ status: 'failed', log: id(1) }))
    expect(page.linked_log).toBeNull()
    calls = []
    await loadAutomationHistory(db(), 'w', auto, parseHistoryQuery({ cursor: historyCursor({ created_at: timestamp, id: id(3) }), log: id(1) }))
    expect(calls).not.toContainEqual(['automation_logs', 'eq', 'id', id(1)])
  })
  it('removes joined contact details if a legacy cross-workspace FK is inconsistent', async () => {
    tables.contacts[0].workspace_id = 'other'
    const page = await loadAutomationHistory(db(), 'w', auto, parseHistoryQuery({ limit: 1, log: id(1) }))
    expect(page.logs[0].contact).toBeUndefined()
    expect(page.linked_log?.contact).toBeUndefined()
    expect(JSON.stringify(page)).not.toContain('573000000000')
  })
  it.each(['automations', 'automation_logs', 'contacts'])('fails closed when %s cannot be read', async table => {
    failing = table
    await expect(loadAutomationHistory(db(), 'w', auto, parseHistoryQuery({}))).rejects.toThrow('unavailable')
  })
})

describe('history input', () => {
  it.each([{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { status: 'running' }, { contact_id: 'other' }, { log: '1' }, { workspace_id: 'other' }, { cursor: '{}' }, { cursor: '{"created_at":"x),id.gt.x","id":"a"}' }, { from: '2026-10-01' }, { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }])('rejects malformed or expanded inputs %j', value => {
    expect(() => parseHistoryQuery(value)).toThrow('automation_history_invalid')
  })
  it('accepts exact PostgreSQL microseconds and UUID or short links', () => {
    expect(parseHistoryQuery({ to: '2026-10-01T23:59:59.999999+00:00', limit: '20' }).limit).toBe(20)
    expect(automationHistoryId.safeParse(auto).success).toBe(true)
    expect(automationHistoryId.safeParse('11111111').success).toBe(true)
    expect(automationHistoryId.safeParse('not-an-id').success).toBe(false)
  })
})
