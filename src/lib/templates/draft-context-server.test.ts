import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
import { loadTemplateDraftContext } from './draft-context-server'
let product: Record<string, unknown> | null, agents: Record<string, unknown>[], error: unknown
const filters: unknown[][] = []
const db = { from: (table: string) => {
  const result = () => ({ data: table === 'shopify_products' ? product : agents, error })
  const q = { select: () => q, eq: (...values: unknown[]) => { filters.push([table, ...values]); return q }, order: () => q, limit: () => q,
    maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) }
  return q
} } as unknown as SupabaseClient
beforeEach(() => { product = { id: 'product', title: 'Serum' }; agents = [{ id: 'assistant', name: 'Business', tone: 'friendly' }]; error = null; filters.length = 0 })
describe('business-scoped draft source loading', () => {
  it('loads the exact product in the current business and its one active profile', async () => {
    const context = await loadTemplateDraftContext(db, 'workspace', { product_id: 'product' })
    expect(filters).toContainEqual(['shopify_products', 'workspace_id', 'workspace'])
    expect(filters).toContainEqual(['shopify_products', 'id', 'product'])
    expect(filters).toContainEqual(['ai_agents', 'workspace_id', 'workspace'])
    expect(filters).toContainEqual(['ai_agents', 'is_active', true])
    expect(context.sources).toHaveLength(2)
  })
  it('does not choose arbitrary training when several profiles are active', async () => {
    agents.push({ id: 'other', name: 'Other profile' })
    const context = await loadTemplateDraftContext(db, 'workspace', {})
    expect(context.sources).toEqual([])
    expect(JSON.parse(context.text).business).toBeNull()
  })
  it('rejects absent, cross-business or inactive selections rather than falling back', async () => {
    product = null; await expect(loadTemplateDraftContext(db, 'workspace', { product_id: 'other' })).rejects.toThrow('template_draft_context_invalid')
    agents = []; await expect(loadTemplateDraftContext(db, 'workspace', { agent_id: 'other' })).rejects.toThrow('template_draft_context_invalid')
    expect(filters).toContainEqual(['ai_agents', 'id', 'other'])
  })
  it('fails closed on source database errors', async () => {
    error = { message: 'private database error' }
    await expect(loadTemplateDraftContext(db, 'workspace', {})).rejects.toThrow('template_draft_context_unavailable')
  })
  it('can draft from the brief alone without changing or loading existing business knowledge', async () => {
    agents = [{ id: 'assistant', name: 'Business', knowledge: 'x'.repeat(100000) }]
    expect((await loadTemplateDraftContext(db, 'workspace', { use_business_context: false })).sources).toEqual([])
    expect(filters.some(filter => filter[0] === 'ai_agents')).toBe(false)
    await expect(loadTemplateDraftContext(db, 'workspace', { use_business_context: false, agent_id: 'assistant' })).rejects.toThrow('template_draft_context_invalid')
  })
})
