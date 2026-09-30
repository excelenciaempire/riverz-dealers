import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ user: { id: 'owner' } as { id: string } | null, workspace: 'workspace-a' as string | null,
  rpc: vi.fn(), eq: vi.fn(), access: true, csrf: null as Response | null, exists: true }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: m.user } }) } }) }))
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => m.workspace }))
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => m.csrf }))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }))
vi.mock('@/lib/inbox/access', () => ({ PERSONAL_EMAIL_CHANNELS: ['gmail', 'outlook', 'zoho'], canAccessConversation: async () => m.access }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ rpc: m.rpc, from: () => {
  const query = { select: () => query, is: () => query, eq: (key: string, value: string) => { m.eq(key, value); return query },
    maybeSingle: async () => ({ data: m.exists ? { id: '66666666-6666-4666-8666-666666666666', channel: 'whatsapp', case_priority: 'normal', case_reason: null } : null, error: null }) }
  return query
} }) }))
import { POST } from './route'
const conv = '66666666-6666-4666-8666-666666666666'
const note = '77777777-7777-4777-8777-777777777777'
const route = { params: Promise.resolve({ id: conv }) }
const request = (body: unknown) => new Request(`https://riverz.co/api/conversations/${conv}/collaboration`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(() => { m.user = { id: 'owner' }; m.workspace = 'workspace-a'; m.access = true; m.csrf = null; m.exists = true; m.eq.mockReset(); m.rpc.mockReset().mockResolvedValue({ data: note, error: null }) })
describe('collaboration write authorization', () => {
  it('derives note actor and workspace from the session, ignoring forged fields', async () => {
    const response = await POST(request({ action: 'note', id: note, body: 'Private note', mentions: [], workspace_id: 'workspace-b', author_id: 'another-user' }), route)
    expect(response.status).toBe(201)
    expect(m.rpc).toHaveBeenCalledWith('add_conversation_note', { p_id: note, p_workspace_id: 'workspace-a', p_conversation_id: conv, p_author_id: 'owner', p_body: 'Private note', p_mentions: [] })
    expect(m.eq).toHaveBeenCalledWith('workspace_id', 'workspace-a')
  })
  it('rejects personal email access before saving', async () => {
    m.access = false
    expect((await POST(request({ action: 'note', id: note, body: 'Private note', mentions: [] }), route)).status).toBe(404)
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('rejects unsigned requests and invalid presence booleans', async () => {
    m.user = null
    expect((await POST(request({ action: 'note', id: note, body: 'Private note', mentions: [] }), route)).status).toBe(401)
    m.user = { id: 'owner' }
    expect((await POST(request({ action: 'presence', session_id: note, composing: 'false', version: 1 }), route)).status).toBe(400)
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('enforces CSRF before a write', async () => {
    m.csrf = new Response(null, { status: 403 })
    expect((await POST(request({ action: 'note', id: note, body: 'Private note', mentions: [] }), route)).status).toBe(403)
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('preserves the session scope when updating a presence lease', async () => {
    expect((await POST(request({ action: 'presence', session_id: note, composing: true, version: 2 }), route)).status).toBe(200)
    expect(m.rpc).toHaveBeenCalledWith('update_conversation_presence', { p_workspace_id: 'workspace-a', p_conversation_id: conv, p_user_id: 'owner', p_session_id: note, p_composing: true, p_version: 2 })
  })
})
