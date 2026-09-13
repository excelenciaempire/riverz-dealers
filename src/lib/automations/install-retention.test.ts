import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { installRetentionPackage } from './install-retention'

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], writes: [] as Record<string, unknown>[], failSteps: false, next: 0 }))
vi.mock('@/lib/contacts/tags', () => ({ ensureTag: vi.fn(async () => `00000000-0000-4000-8000-${String(++state.next).padStart(12, '0')}`) }))
vi.mock('@/lib/templates/create', () => ({ crearPlantilla: vi.fn(async (_db, input) => {
  state.writes.push(input)
  return { ok: true, id: `t${state.writes.length}`, name: input.nombre, estado: 'Draft' }
}) }))
vi.mock('./steps-tree', () => ({ insertSteps: vi.fn(async () => state.failSteps ? 'step insert failed' : null), loadStepsTree: vi.fn(async () => [{ step_type: 'wait' }]) }))

function fakeDb() {
  const queries: Array<{ table: string; filters: Record<string, unknown>; op: string }> = []
  return { queries, db: { from(table: string) {
    const q = { table, filters: {} as Record<string, unknown>, op: 'read', payload: {} as Record<string, unknown> }
    queries.push(q)
    const result = () => {
      if (q.op === 'insert') { const row = { ...q.payload, id: `a${state.rows.length + 1}` }; state.rows.push(row); return { data: row, error: null } }
      if (q.op === 'delete') { state.rows = []; return { data: null, error: null } }
      return { data: table === 'automations' ? state.rows : null, error: null }
    }
    const chain = {
      select: () => chain, eq: (k: string, v: unknown) => { q.filters[k] = v; return chain },
      is: (k: string, v: unknown) => { q.filters[k] = v; return chain },
      contains: (k: string, v: unknown) => { q.filters[k] = v; return chain },
      in: (k: string, v: unknown) => { q.filters[k] = v; return chain },
      insert: (p: Record<string, unknown>) => { q.op = 'insert'; q.payload = p; return chain },
      delete: () => { q.op = 'delete'; return chain },
      single: async () => result(), maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return chain
  } } as unknown as SupabaseClient }
}
beforeEach(() => { state.rows = []; state.writes = []; state.failSteps = false; state.next = 0 })
const opts = { workspaceId: 'workspace-a', userId: 'owner-a', locale: 'en' as const, product: 'Coffee', offers: [{ units: 1, day: 22, label: '1 bag' }], installationKey: 'retention_test' }
describe('retention package installation', () => {
  it('creates only inert tenant-owned drafts, and does not rewrite an existing package', async () => {
    const { db, queries } = fakeDb()
    const pack = await installRetentionPackage(db, opts)
    expect(pack.automations).toHaveLength(1)
    expect(pack.templates).toHaveLength(6)
    expect(state.rows.every(a => a.workspace_id === opts.workspaceId && a.is_active === false && a.activation_state === 'draft')).toBe(true)
    expect(state.writes.every(t => t.enviarAMeta === false && t.workspaceId === opts.workspaceId && t.userId === null)).toBe(true)
    expect(queries.filter(q => q.op === 'read').every(q => q.filters.workspace_id === opts.workspaceId)).toBe(true)
    const repeat = await installRetentionPackage(db, opts)
    expect(repeat.reused).toBe(true)
    expect(state.writes).toHaveLength(6)
    expect(state.rows).toHaveLength(1)
  })
  it('supports the incomplete-product global care draft without creating sales templates', async () => {
    const { db } = fakeDb()
    const pack = await installRetentionPackage(db, { ...opts, offers: [], requireProductSelection: true })
    expect(pack.automations).toHaveLength(1)
    expect(pack.templates).toHaveLength(3)
  })
  it('rolls back only its newly created inactive automations on a step failure', async () => {
    const { db, queries } = fakeDb()
    state.failSteps = true
    await expect(installRetentionPackage(db, opts)).rejects.toThrow('step insert failed')
    expect(queries.find(q => q.op === 'delete')?.filters).toEqual({ workspace_id: opts.workspaceId, is_active: false, id: ['a1'] })
    expect(state.rows).toEqual([])
  })
})
