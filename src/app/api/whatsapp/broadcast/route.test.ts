import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ workspace: 'workspace-a' as string | null, from: vi.fn(), send: vi.fn(), filters: [] as unknown[][] }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'member' } } }) } }) }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ from: m.from }) }))
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => m.workspace }))
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => null }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'test-token' }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTemplateMessage: m.send }))
vi.mock('@/lib/whatsapp/throttle', () => ({ acquire: async () => {} }))
vi.mock('@/lib/whatsapp/tier-cap', () => ({ resolveWhatsAppConnectionId: async () => null, assertWithinTierCap: vi.fn() }))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }))
vi.mock('@/lib/i18n/translate', () => ({ translate: (_: string, key: string) => key }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), rateLimitResponse: vi.fn(), RATE_LIMITS: { broadcast: {} } }))
import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks(); m.workspace = 'workspace-a'; m.filters = []
  m.send.mockResolvedValue({ messageId: 'wamid.test' })
  m.from.mockImplementation((table: string) => {
    const q = { select: () => q, eq: (...args: unknown[]) => { m.filters.push([table, ...args]); return q }, single: async () => ({ data: { access_token: 'encrypted', phone_number_id: 'business-phone' } }) }
    return q
  })
})
const request = () => new Request('http://localhost/api/whatsapp/broadcast', { method: 'POST', body: JSON.stringify({ recipients: [{ phone: '573003364305', params: ['Juan'] }], template_name: 'review', template_language: 'es' }) })

describe('campaign credential access', () => {
  it('reads credentials on the server in the resolved workspace, without requiring caller ownership', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(m.filters).toContainEqual(['whatsapp_config', 'workspace_id', 'workspace-a'])
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ phoneNumberId: 'business-phone', to: '573003364305', params: ['Juan'] }))
  })
  it('does not read credentials or send when the caller has no workspace', async () => {
    m.workspace = null
    expect((await POST(request())).status).toBe(403)
    expect(m.from).not.toHaveBeenCalled()
    expect(m.send).not.toHaveBeenCalled()
  })
})
