/* eslint-disable @typescript-eslint/no-explicit-any -- Stateful scoped Supabase query double. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { abrirDevolucion, type DevolucionCtx } from './open'

vi.mock('@/lib/approvals/ask', () => ({ quienDecide: vi.fn(async () => null) }))
vi.mock('@/lib/admin/platform-whatsapp', () => ({ sendPlatformAlert: vi.fn() }))

const workspaceId = 'own-business', contactId = 'own-contact', conversationId = 'own-conversation', agentId = 'own-agent'
let tables: Record<string, any[]>, writes: any[], reads: string[], failedTable: string | undefined, insertError: string | undefined
function context(): DevolucionCtx {
  const db = { from(table: string) {
    const predicates: Array<(row: any) => boolean> = []
    let maximum = Infinity, sortedBy: string | undefined, inserted: any
    const field = (row: any, key: string) => key.split('.').reduce((value, part) => value?.[part], row)
    const execute = () => {
      reads.push(table)
      if (table === failedTable) return { data: null, error: { message: 'private database detail' } }
      let rows = tables[table].filter(row => predicates.every(test => test(row)))
      if (sortedBy) rows = [...rows].sort((a, b) => String(b[sortedBy!]).localeCompare(String(a[sortedBy!])))
      return { data: rows.slice(0, maximum), error: null }
    }
    const query: any = {
      select: () => query,
      eq: (key: string, value: unknown) => { predicates.push(row => field(row, key) === value); return query },
      is: (key: string, value: unknown) => { predicates.push(row => field(row, key) === value); return query },
      not: (key: string, operator: string, value: unknown) => {
        predicates.push(row => operator === 'is' ? field(row, key) !== value : !['cancelled', 'failed'].includes(field(row, key)))
        return query
      },
      like: (key: string, value: string) => { predicates.push(row => typeof field(row, key) === 'string' && field(row, key).startsWith(value.slice(0, -1))); return query },
      or: (expression: string) => {
        const numbers = [...expression.matchAll(/order_number\.eq\."([^"]*)"/g)].map(match => match[1])
        predicates.push(row => numbers.includes(row.order_number)); return query
      },
      order: (key: string) => { sortedBy = key; return query },
      limit: (value: number) => { maximum = value; return query },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null } },
      insert: (value: any) => { inserted = value; return query },
      single: async () => {
        if (insertError) return { data: null, error: { code: insertError } }
        writes.push(inserted)
        return { data: { id: 'new-case', order_number: inserted.order_number }, error: null }
      },
      then: (resolve: (value: unknown) => unknown) => resolve(execute()),
    }
    return query
  } } as unknown as SupabaseClient
  return { db, workspaceId, contactId, conversationId, agentId }
}
function photo(overrides: Record<string, unknown> = {}) {
  return { conversation_id: conversationId, conversation: { workspace_id: workspaceId, contact_id: contactId }, sender_type: 'customer', media_url: 'https://example.invalid/photo.jpg', media_mime: 'image/jpeg', created_at: '2026-10-01T00:00:00Z', ...overrides }
}
async function open(input: Parameters<typeof abrirDevolucion>[1] = {}, ctx = context()) { return JSON.parse(await abrirDevolucion(ctx, input)) }
beforeEach(() => {
  tables = {
    contacts: [{ id: contactId, workspace_id: workspaceId }],
    conversations: [{ id: conversationId, workspace_id: workspaceId, contact_id: contactId, deleted_at: null }],
    ai_agents: [{ id: agentId, workspace_id: workspaceId }],
    orders: [{ id: 'own-order', workspace_id: workspaceId, contact_id: contactId, order_number: '#1001', status: 'paid', created_at: '2026-10-01T00:00:00Z' }],
    messages: [photo()], returns: [],
  }
  writes = []; reads = []; failedTable = undefined; insertError = undefined
})

describe('opening a return from the existing assistant', () => {
  it('links the owned order and conversation photos without approving or executing money', async () => {
    expect(await open({ order_number: '1001', kind: 'cambio', reason: ' Damaged ', customer_note: ' Please review ' })).toMatchObject({ ok: true, estado: 'abierta', return_id: 'new-case', fotos: 1 })
    expect(writes).toEqual([expect.objectContaining({ workspace_id: workspaceId, contact_id: contactId, conversation_id: conversationId, agent_id: agentId, order_id: 'own-order', order_number: '#1001', kind: 'cambio', reason: 'Damaged', customer_note: 'Please review', photos: ['https://example.invalid/photo.jpg'], created_by: 'ai' })])
    expect(writes[0]).not.toHaveProperty('status'); expect(writes[0]).not.toHaveProperty('refund')
  })
  it.each(['contacts', 'conversations', 'ai_agents', 'orders', 'messages'])('stops before writing when the %s read fails', async table => {
    failedTable = table
    const result = await open({ order_number: '1001' })
    expect(result).toMatchObject({ ok: false, error: 'return_unavailable' }); expect(writes).toEqual([])
    expect(JSON.stringify(result)).not.toContain('private database detail')
  })
  it.each(['contacts', 'conversations', 'ai_agents'])('rejects a %s identity from another business', async table => {
    tables[table][0].workspace_id = 'foreign-business'
    expect(await open({ order_number: '1001' })).toMatchObject({ ok: false, error: 'invalid_return_context' })
    expect(writes).toEqual([]); expect(reads).not.toContain('orders'); expect(reads).not.toContain('messages')
  })
  it.each(['contact', 'deleted'])('rejects a conversation whose %s no longer matches', async change => {
    if (change === 'contact') tables.conversations[0].contact_id = 'foreign-contact'
    else tables.conversations[0].deleted_at = '2026-10-01T00:00:01Z'
    expect(await open()).toMatchObject({ ok: false, error: 'invalid_return_context' }); expect(writes).toEqual([])
  })
  it('supports a contact-only case without querying optional conversation or agent', async () => {
    const ctx = context(); ctx.conversationId = null; ctx.agentId = null
    expect(await open({}, ctx)).toMatchObject({ ok: true, fotos: 0 })
    expect(writes[0]).toMatchObject({ conversation_id: null, agent_id: null, photos: [] })
    expect(reads).not.toContain('conversations'); expect(reads).not.toContain('ai_agents'); expect(reads).not.toContain('messages')
  })
  it('retains a manually supplied order number when no owned mirror exists', async () => {
    tables.orders[0].workspace_id = 'foreign-business'
    tables.orders.push({ ...tables.orders[0], workspace_id: workspaceId, contact_id: 'foreign-contact' })
    expect(await open({ order_number: '#1001' })).toMatchObject({ ok: true, estado: 'abierta' })
    expect(writes[0]).toMatchObject({ order_id: null, order_number: '1001' })
  })
  it('asks for the order number when no eligible order exists', async () => {
    tables.orders[0].status = 'cancelled'
    expect(await open()).toMatchObject({ ok: false, error: 'sin_pedido' }); expect(writes).toEqual([])
  })
  it.each([undefined, '1001'])('asks before choosing among multiple orders with input %s', async order_number => {
    tables.orders.push({ ...tables.orders[0], id: 'second-order' })
    expect(await open({ order_number })).toMatchObject({ ok: false, error: 'varios_pedidos' })
    expect(writes).toEqual([]); expect(reads).not.toContain('messages')
  })
  it('takes the latest six customer images, excluding other media, people and businesses before limiting', async () => {
    tables.messages = Array.from({ length: 8 }, (_, index) => photo({ media_url: `image-${index}`, created_at: `2026-10-01T00:00:0${index}Z` }))
    tables.messages.push(
      photo({ media_url: 'video', media_mime: 'video/mp4', created_at: '2026-10-01T01:00:00Z' }),
      photo({ media_url: 'advisor', sender_type: 'agent', created_at: '2026-10-01T01:00:00Z' }),
      photo({ media_url: 'foreign-business', conversation: { workspace_id: 'foreign', contact_id: contactId } }),
      photo({ media_url: 'foreign-contact', conversation: { workspace_id: workspaceId, contact_id: 'foreign' } }),
      photo({ media_url: 'different-conversation', conversation_id: 'another' }),
      photo({ media_url: null }),
    )
    expect(await open()).toMatchObject({ ok: true, fotos: 6 })
    expect(writes[0].photos).toEqual(['image-7', 'image-6', 'image-5', 'image-4', 'image-3', 'image-2'])
  })
  it('records a valid case without inventing photos when the successful image query is empty', async () => {
    tables.messages = []
    expect(await open()).toMatchObject({ ok: true, fotos: 0 }); expect(writes[0].photos).toEqual([])
  })
  it('preserves the existing duplicate-case response without a second write', async () => {
    insertError = '23505'
    expect(await open()).toMatchObject({ ok: true, estado: 'ya_abierta' }); expect(writes).toEqual([])
  })
  it('does not claim a case was recorded after an insert failure', async () => {
    insertError = 'XX000'
    expect(await open()).toMatchObject({ ok: false }); expect(writes).toEqual([])
  })
})
