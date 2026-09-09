import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  gate: vi.fn(), key: vi.fn(), claim: vi.fn(), execute: vi.fn(), mark: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } }) }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => 'workspace' }))
vi.mock('@/lib/admin/feature-flags', () => ({ getFeatureFlags: async () => ({}), isOperatorFleet: () => true, isRiverz2: () => true }))
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ limitByKey: async () => ({ success: true }) }))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }))
vi.mock('@/lib/wallet/puerta', () => ({ exigirSaldo: mocks.gate }))
vi.mock('@/lib/ai/platform-key', () => ({ resolveAnthropicKey: mocks.key }))
vi.mock('@/lib/ai/anthropic-client', () => ({ getAnthropicStreaming: () => ({}) }))
vi.mock('@/lib/operator/fleet/runner', () => ({ anthropicRunner: () => vi.fn() }))
vi.mock('@/lib/operator/fleet/plan', () => ({
  cargarPlan: async () => ({ id: 'plan', threadId: 'thread', pasos: [] }),
  reclamarPlan: mocks.claim, marcarPlan: mocks.mark,
}))
vi.mock('@/lib/operator/fleet/ejecutar-plan', () => ({ ejecutarPlan: mocks.execute }))
vi.mock('@/lib/operator/gasto', () => ({ guardarGasto: async () => {} }))
vi.mock('@/lib/operator/threads', () => ({ appendMessage: async () => {} }))
import { POST } from './route'

const request = () => POST(new Request('https://example.test/plan', { method: 'POST' }), { params: Promise.resolve({ id: 'plan' }) })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.gate.mockResolvedValue(null)
  mocks.key.mockResolvedValue({ key: 'test', source: 'platform' })
  mocks.claim.mockResolvedValue(true)
  mocks.mark.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue({ estado: 'parcial', pasos: [{ estado: 'saltado', agente: 'plantillas', resumen: '' }], propuestas: 0, construidas: 0 })
})
describe('approved plan preflight and outcome', () => {
  it.each(['sin_saldo', 'suscripcion_vencida'])('rejects %s before claiming or executing', async (error) => {
    mocks.gate.mockResolvedValue(Response.json({ error }, { status: 402 }))
    expect((await request()).status).toBe(402)
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('keeps the plan retryable when the provider key is missing', async () => {
    mocks.key.mockResolvedValue(null)
    expect((await request()).status).toBe(400)
    expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('does not execute a plan already claimed', async () => {
    mocks.claim.mockResolvedValue(false)
    expect((await request()).status).toBe(409)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('preserves partial results with skipped steps and localizes the summary', async () => {
    const text = await (await request()).text()
    expect(mocks.mark).toHaveBeenCalledWith({}, 'plan', 'workspace', 'parcial')
    expect(text).toContain('step skipped')
  })
  it('reports a failure without leaking raw provider errors', async () => {
    mocks.execute.mockRejectedValue(new Error('private provider detail'))
    const text = await (await request()).text()
    expect(text).toContain('"estado":"fallido"')
    expect(text).not.toContain('private provider detail')
  })
})
