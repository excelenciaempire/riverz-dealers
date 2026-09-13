import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mirrorBroadcastDelivery } from './delivery-status'

function database(current = 'sent', workspace = 'workspace-a') {
  const row = { status: current } as Record<string, unknown>
  const filters: unknown[][] = []
  const db = { from: () => {
    let patch: Record<string, unknown> | null = null
    let match = true
    const q = {
      select: () => q,
      update: (value: Record<string, unknown>) => { patch = value; return q },
      eq: (key: string, value: unknown) => { filters.push([key, value]); if (key === 'broadcasts.workspace_id') match = value === workspace; return q },
      in: (_: string, allowed: string[]) => { if (patch && allowed.includes(row.status as string)) Object.assign(row, patch); return q },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: match ? [{ id: 'recipient' }] : [], error: null }).then(resolve),
    }
    return q
  } } as unknown as SupabaseClient
  return { db, row, filters }
}
describe('unified WhatsApp campaign receipts', () => {
  it('mirrors delivery independently of any inbox message', async () => {
    const m = database()
    await mirrorBroadcastDelivery(m.db, 'workspace-a', { id: 'wamid', status: 'delivered', timestamp: '1789334400' })
    expect(m.row).toEqual({ status: 'delivered', delivered_at: '2026-09-13T21:20:00.000Z' })
  })
  it('does not touch another workspace', async () => {
    const m = database()
    await mirrorBroadcastDelivery(m.db, 'workspace-b', { id: 'wamid', status: 'delivered', timestamp: '1789334400' })
    expect(m.row.status).toBe('sent')
  })
  it('does not regress a read receipt on out-of-order delivery or failure', async () => {
    const m = database('read')
    for (const status of ['sent', 'delivered', 'failed']) await mirrorBroadcastDelivery(m.db, 'workspace-a', { id: 'wamid', status, timestamp: '1789334400' })
    expect(m.row).toEqual({ status: 'read' })
  })
})
