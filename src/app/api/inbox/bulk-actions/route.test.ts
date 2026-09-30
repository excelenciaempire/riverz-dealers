import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  blocked: null as Response | null, csrf: null as Response | null,
  forbidden: '', missing: false, stale: false, fail: '', rpc: vi.fn(), filters: vi.fn(),
}))
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => m.csrf }))
vi.mock('@/lib/inbox/access', () => ({ canAccessConversation: async (_db: unknown, _user: string, c: { id: string }) => c.id !== m.forbidden }))
vi.mock('@/lib/inbox/server-context', () => ({ inboxSession: async () => m.blocked ? { response: m.blocked } : {
  userId: 'session-user', workspaceId: 'session-workspace', t: (key: string) => key,
  db: { rpc: m.rpc, from: (table: string) => {
    const q = { select: () => q, eq: (key: string, value: unknown) => { m.filters(table, key, value); return q },
      in: () => q, is: () => q,
      maybeSingle: async () => ({ error: null, data: { id: macroId, version: m.stale ? 2 : 1, is_active: !m.stale, actions: [{ type: 'resume' }] } }),
      then: (resolve: (value: unknown) => void) => resolve({ error: null, data: m.missing ? [{ id: first }] : [{ id: first }, { id: second }] }),
    }; return q
  } },
} }))
import { POST } from './route'
import { bulkCaseRunId } from '@/lib/inbox/bulk-actions'
const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const batchId = '33333333-3333-4333-8333-333333333333'
const macroId = '44444444-4444-4444-8444-444444444444'
const body = { id: batchId, ids: [second, first], macro_id: macroId, version: 1, dry_run: false }
const request = (patch = {}) => new Request('https://riverz.co/api/inbox/bulk-actions', { method: 'POST', body: JSON.stringify({ ...body, ...patch }) })
beforeEach(() => {
  m.blocked = null; m.csrf = null; m.forbidden = ''; m.missing = false; m.stale = false; m.fail = ''
  m.rpc.mockReset(); m.filters.mockReset()
  m.rpc.mockImplementation(async (_name, args) => ({ data: [{ type: 'resume' }], error: args.p_conversation_id === m.fail ? { message: 'failed' } : null }))
})
describe('bulk macro authorization and explicit preview', () => {
  it('previews exactly the selected cases without mutations', async () => {
    const r = await POST(request({ dry_run: true }))
    expect(r.status).toBe(200)
    expect((await r.json()).cases).toHaveLength(2)
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('authorizes every case before applying any; personal mail or missing rows block the whole batch', async () => {
    m.forbidden = second
    expect((await POST(request())).status).toBe(404)
    expect(m.rpc).not.toHaveBeenCalled()
    m.forbidden = ''; m.missing = true
    expect((await POST(request())).status).toBe(404)
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('uses session context, deterministic retries and separate results for each explicit case', async () => {
    m.fail = second
    const r = await POST(request())
    expect(r.status).toBe(207)
    expect((await r.json()).results).toEqual([
      { id: first, ok: true, result: [{ type: 'resume' }] },
      { id: second, ok: false, error: 'bulkMacroFailed' },
    ])
    expect(m.rpc).toHaveBeenCalledWith('apply_inbox_actions', expect.objectContaining({ p_id: bulkCaseRunId(batchId, first), p_actor_id: 'session-user', p_workspace_id: 'session-workspace' }))
    expect(m.filters).toHaveBeenCalledWith('conversations', 'workspace_id', 'session-workspace')
  })
  it('blocks stale previews but allows the database to recover an already completed old-version retry', async () => {
    m.stale = true
    expect((await POST(request({ dry_run: true }))).status).toBe(409)
    expect(m.rpc).not.toHaveBeenCalled()
    expect((await POST(request())).status).toBe(200)
    expect(m.rpc).toHaveBeenCalledTimes(2)
  })
  it('rejects client workspace, channel scope, excessive selection, CSRF and missing authentication', async () => {
    for (const patch of [{ workspace_id: 'other' }, { channel: 'whatsapp' }, { ids: Array(101).fill(first) }]) expect((await POST(request(patch))).status).toBe(400)
    m.csrf = new Response(null, { status: 403 }); expect((await POST(request())).status).toBe(403)
    m.csrf = null; m.blocked = new Response(null, { status: 401 }); expect((await POST(request())).status).toBe(401)
    expect(m.rpc).not.toHaveBeenCalled()
  })
})
