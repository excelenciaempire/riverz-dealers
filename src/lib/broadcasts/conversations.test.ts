import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordBroadcastConversation } from './conversations'

const args = { contactId: 'contact', workspaceId: 'workspace', connectionId: 'connection', templateName: 'hello', bodyPreview: 'Hello', whatsappMessageId: 'wamid' }
let recorded: unknown[], readError: unknown, insertError: unknown
const filters: unknown[][] = [], writes = vi.fn()
const db = { from: (table: string) => {
  let inserting = false
  const result = () => ({ data: table === 'messages' ? recorded : { id: 'thread' }, error: inserting ? insertError : readError })
  const q = {
    select: () => q, eq: (...values: unknown[]) => { filters.push([table, ...values]); return q }, is: () => q, neq: () => q,
    limit: () => q, maybeSingle: async () => result(), single: async () => result(),
    insert: (row: unknown) => { inserting = true; writes(table, 'insert', row); return q },
    update: (row: unknown) => { writes(table, 'update', row); return q },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return q
} } as unknown as SupabaseClient
beforeEach(() => { recorded = []; readError = null; insertError = null; filters.length = 0; writes.mockClear() })
describe('campaign inbox receipt repair', () => {
  it('keeps existing proof in its original thread without creating or bumping anything', async () => {
    recorded = [{ id: 'already-recorded' }]
    await recordBroadcastConversation(db, args)
    expect(writes).not.toHaveBeenCalled()
    expect(filters).toContainEqual(['messages', 'conversation.workspace_id', 'workspace'])
    expect(filters).toContainEqual(['messages', 'conversation.contact_id', 'contact'])
  })
  it('repairs missing proof only in the current business and connection', async () => {
    await recordBroadcastConversation(db, args)
    expect(filters).toContainEqual(['conversations', 'workspace_id', 'workspace'])
    expect(filters).toContainEqual(['conversations', 'connection_id', 'connection'])
    expect(writes).toHaveBeenCalledWith('messages', 'insert', expect.objectContaining({ message_id: 'wamid', conversation_id: 'thread' }))
    expect(writes).toHaveBeenCalledWith('conversations', 'update', expect.anything())
  })
  it('does not manufacture a thread when checking previous proof fails', async () => {
    readError = { code: 'network' }
    await expect(recordBroadcastConversation(db, args)).rejects.toThrow('broadcast_conversation_unavailable')
    expect(writes).not.toHaveBeenCalled()
  })
  it('preserves the thread timestamp on concurrent duplicate insertion or failed recording', async () => {
    insertError = { code: '23505' }; await recordBroadcastConversation(db, args)
    expect(writes.mock.calls.some(c => c[1] === 'update')).toBe(false)
    insertError = { code: 'network' }
    await expect(recordBroadcastConversation(db, args)).rejects.toThrow('broadcast_conversation_unavailable')
    expect(writes.mock.calls.some(c => c[1] === 'update')).toBe(false)
  })
})
