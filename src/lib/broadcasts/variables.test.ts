import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveBroadcastParams } from './variables'
let rows: { custom_field_id: string; value: string | null }[], error: unknown
const filters: unknown[][] = []
const from = vi.fn(() => {
  const q = { select: () => q, eq: (...args: unknown[]) => { filters.push(args); return q }, in: (...args: unknown[]) => { filters.push(args); return q },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(resolve) }
  return q
})
const db = { from } as unknown as SupabaseClient
const contact = { id: 'contact', name: 'Ana Perez', phone: '573000000000', shopify_customer_data: { orders_count: 3 } }
beforeEach(() => { vi.clearAllMocks(); filters.length = 0; rows = []; error = null })
describe('campaign parameters with fixed and dynamic values', () => {
  it('updates mapped positions while preserving fixed values and the input snapshot', async () => {
    const fallback = ['Previous name', 'Bundle with shipping excluded', 'Previous phone']
    expect(await resolveBroadcastParams(db, contact, fallback, { '1': 'first_name', '3': 'phone' })).toEqual(['Ana', 'Bundle with shipping excluded', '573000000000'])
    expect(fallback).toEqual(['Previous name', 'Bundle with shipping excluded', 'Previous phone']); expect(from).not.toHaveBeenCalled()
  })
  it('supports all-dynamic campaigns without fallback values', async () => {
    expect(await resolveBroadcastParams(db, contact, null, { '2': 'shopify_orders_count', '1': 'name' })).toEqual(['Ana Perez', '3'])
  })
  it('keeps static-only and empty mappings unchanged', async () => {
    expect(await resolveBroadcastParams(db, contact, ['Fixed'], null)).toEqual(['Fixed'])
    expect(await resolveBroadcastParams(db, contact, ['Fixed'], {})).toEqual(['Fixed']); expect(from).not.toHaveBeenCalled()
  })
  it.each([{ '0': 'name' }, { '01': 'name' }, { '65': 'name' }, { wrong: 'name' }, { '2': 'name' }] as Record<string, string>[])('rejects invalid positions or a missing unfilled position (%j)', async mapping => {
    await expect(resolveBroadcastParams(db, contact, null, mapping)).rejects.toThrow('broadcast_delivery_variables'); expect(from).not.toHaveBeenCalled()
  })
  it('loads custom values for the exact recipient and preserves fixed neighboring slots', async () => {
    rows = [{ custom_field_id: 'custom', value: 'VIP' }]
    expect(await resolveBroadcastParams(db, contact, ['Ana', 'old', 'Fixed'], { '2': 'custom' })).toEqual(['Ana', 'VIP', 'Fixed'])
    expect(filters).toContainEqual(['contact_id', 'contact']); expect(filters).toContainEqual(['custom_field_id', ['custom']])
  })
  it('does not turn a database failure into an empty personalized value', async () => {
    error = { message: 'private database failure' }
    await expect(resolveBroadcastParams(db, contact, ['old'], { '1': 'custom' })).rejects.toThrow('broadcast_delivery_unavailable')
  })
})
