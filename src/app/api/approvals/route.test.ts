import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ user: { id: 'owner' } as { id: string } | null, workspace: 'current-workspace' as string | null, eq: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => state.admin() }))
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => state.workspace }))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }))
import { GET } from './route'

beforeEach(() => {
  state.user = { id: 'owner' }; state.workspace = 'current-workspace'; state.eq.mockReset(); state.admin.mockReset()
  const query = { select: () => query, eq: (key: string, value: string) => { state.eq(key, value); return query },
    gt: () => query, order: () => query, limit: () => query,
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) }
  state.admin.mockReturnValue({ from: () => query })
})
describe('contextual approval list', () => {
  it('uses the session workspace and the exact contact, ignoring a caller workspace', async () => {
    const contact = '11111111-1111-4111-8111-111111111111'
    const response = await GET(new Request(`https://riverzai.com/api/approvals?contact_id=${contact}&workspace_id=another-workspace`))
    expect(response.status).toBe(200)
    expect(state.eq).toHaveBeenCalledWith('workspace_id', 'current-workspace')
    expect(state.eq).toHaveBeenCalledWith('contact_id', contact)
    expect(state.eq).not.toHaveBeenCalledWith('workspace_id', 'another-workspace')
  })
  it('rejects malformed contact filters before accessing the service client', async () => {
    const response = await GET(new Request('https://riverzai.com/api/approvals?contact_id=bad,filter'))
    expect(response.status).toBe(400); expect(state.admin).not.toHaveBeenCalled()
  })
  it('rejects unsigned requests with a localized error', async () => {
    state.user = null
    const response = await GET(new Request('https://riverzai.com/api/approvals'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Sign in to decide.' })
    expect(state.admin).not.toHaveBeenCalled()
  })
})
