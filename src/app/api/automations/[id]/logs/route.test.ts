import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn(), locale: 'es' as 'es' | 'en' }))
vi.mock('@/lib/inbox/server-context', () => ({ inboxSession: () => state.session() }))
vi.mock('@/lib/automations/history', () => ({ loadAutomationHistory: (...args: unknown[]) => state.load(...args) }))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => state.locale }))
import { GET } from './route'
const id = '11111111-1111-4111-8111-111111111111'
const request = (query = '', key = id) => GET(new Request(`https://riverz.co/api/automations/${key}/logs${query}`), { params: Promise.resolve({ id: key }) })
beforeEach(() => {
  state.locale = 'es'; state.session.mockReset(); state.load.mockReset()
  state.session.mockResolvedValue({ db: 'trusted-db', workspaceId: 'trusted-workspace' })
  state.load.mockResolvedValue({ automation: { id, name: 'Flow' }, logs: [], linked_log: null, next_cursor: null })
})
describe('private automation history API', () => {
  it.each([401, 403])('requires session and membership before reading a log (%i)', async status => {
    state.session.mockResolvedValue({ response: Response.json({ error: 'denied' }, { status }) })
    expect((await request()).status).toBe(status)
    expect(state.load).not.toHaveBeenCalled()
  })
  it('uses only the trusted workspace, supports short IDs and disables caching', async () => {
    const response = await request('?status=partial&limit=25', '11111111')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(state.load).toHaveBeenCalledWith('trusted-db', 'trusted-workspace', '11111111', { status: 'partial', limit: 25 })
  })
  it.each(['?workspace_id=other', '?status=failed&status=success', '?limit=101', '?cursor=bad', '?contact_id=other'])('rejects invalid or ambiguous query %s before reading', async query => {
    expect((await request(query)).status).toBe(400)
    expect(state.load).not.toHaveBeenCalled()
  })
  it('returns 404 for an invalid link or automation outside the current workspace', async () => {
    expect((await request('', 'invalid')).status).toBe(404)
    state.load.mockRejectedValue(new Error('automation_history_not_found'))
    expect((await request()).status).toBe(404)
  })
  it.each(['es', 'en'] as const)('localizes failures in %s without exposing database details', async locale => {
    state.locale = locale
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.load.mockRejectedValue(new Error('private_database_details'))
    const response = await request(), body = await response.json()
    expect(response.status).toBe(500)
    expect(body.error).toBe(locale === 'es' ? 'No se pudieron cargar los registros' : "Couldn't load the logs")
    expect(JSON.stringify(body)).not.toContain('private_database_details')
    spy.mockRestore()
  })
})
