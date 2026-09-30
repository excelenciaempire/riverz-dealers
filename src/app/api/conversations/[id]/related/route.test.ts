import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  csrf: null as Response | null, user: { id: 'owner' } as { id: string } | null,
  targetAccess: true, found: true, updated: vi.fn(), filters: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: m.user } }) } }) }))
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => 'workspace-a' }))
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => m.csrf }))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }))
vi.mock('@/lib/inbox/access', () => ({ canAccessConversation: async (_db: unknown, _user: string, row: { channel: string }) => row.channel !== 'gmail' || m.targetAccess }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ from: (table: string) => {
  let fields = ''
  let updating = false
  const query = {
    select: (value: string) => { fields = value; return query },
    eq: (key: string, value: string) => { m.filters(table, key, value); return query },
    is: () => query, or: () => query,
    update: (value: unknown) => { m.updated(value); updating = true; return query },
    maybeSingle: async () => ({ error: null, data: updating ? { id: linkId } : table === 'conversation_links'
      ? (m.found ? { source_conversation_id: sourceId, target_conversation_id: targetId } : null)
      : fields === 'channel,connection_id' ? { channel: 'gmail', connection_id: 'private-mailbox' }
        : { id: sourceId, contact_id: 'contact-a', channel: 'whatsapp', connection_id: null } }),
  }
  return query
} }) }))
import { DELETE } from './route'
const sourceId = '66666666-6666-4666-8666-666666666666'
const targetId = '77777777-7777-4777-8777-777777777777'
const linkId = '88888888-8888-4888-8888-888888888888'
const request = () => new Request(`https://riverz.co/api/conversations/${sourceId}/related?id=${linkId}`, { method: 'DELETE' })
const route = { params: Promise.resolve({ id: sourceId }) }
beforeEach(() => { m.csrf = null; m.user = { id: 'owner' }; m.targetAccess = true; m.found = true; m.updated.mockReset(); m.filters.mockReset() })

describe('linked conversation removal', () => {
  it('requires access to both conversations before changing a reference', async () => {
    m.targetAccess = false
    expect((await DELETE(request(), route)).status).toBe(404)
    expect(m.updated).not.toHaveBeenCalled()
  })
  it('preserves history and uses the session actor and workspace', async () => {
    expect((await DELETE(request(), route)).status).toBe(200)
    expect(m.updated).toHaveBeenCalledWith({ unlinked_at: expect.any(String), unlinked_by: 'owner' })
    expect(m.filters).toHaveBeenCalledWith('conversation_links', 'workspace_id', 'workspace-a')
    expect(m.filters).toHaveBeenCalledWith('conversation_links', 'id', linkId)
  })
  it('rejects unavailable links without changing another row', async () => {
    m.found = false
    expect((await DELETE(request(), route)).status).toBe(404)
    expect(m.updated).not.toHaveBeenCalled()
  })
  it('requires authentication and CSRF for deletion', async () => {
    m.user = null
    expect((await DELETE(request(), route)).status).toBe(401)
    m.user = { id: 'owner' }; m.csrf = new Response(null, { status: 403 })
    expect((await DELETE(request(), route)).status).toBe(403)
    expect(m.updated).not.toHaveBeenCalled()
  })
})
