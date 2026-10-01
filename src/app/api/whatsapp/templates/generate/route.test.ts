import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), csrf: vi.fn(), context: vi.fn(), key: vi.fn(), budget: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/inbox/server-context', () => ({ inboxSession: m.session }))
vi.mock('@/lib/csrf', () => ({ csrfGuard: m.csrf }))
vi.mock('@/lib/templates/draft-context-server', () => ({ loadTemplateDraftContext: m.context }))
vi.mock('@/lib/ai/platform-key', () => ({ resolveAnthropicKey: m.key }))
vi.mock('@/lib/ai/rate-limit', () => ({ aiBudgetGuard: m.budget }))
vi.mock('@/lib/ai/anthropic-client', () => ({ getAnthropic: () => ({ messages: { create: m.create } }) }))
vi.mock('@/lib/ai/esfuerzo', () => ({ esfuerzo: () => ({}) }))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ success: true }), RATE_LIMITS: { broadcast: {} }, rateLimitResponse: () => new Response(null, { status: 429 }) }))
import { POST } from './route'
const workspaceId = '11111111-1111-4111-8111-111111111111', productId = '22222222-2222-4222-8222-222222222222'
const ctx = { db: {}, userId: 'user', workspaceId }
const request = (patch: Record<string, unknown> = {}) => new Request('https://riverz.co/api/whatsapp/templates/generate', { method: 'POST', body: JSON.stringify({ brief: 'Explain this product', language: 'es', category: 'MARKETING', product_id: productId, ...patch }) })
beforeEach(() => {
  vi.clearAllMocks(); m.session.mockResolvedValue(ctx); m.csrf.mockResolvedValue(null)
  m.context.mockResolvedValue({ text: 'complete offer conditions', fingerprint: 'snapshot', sources: [{ id: productId, label: 'Serum', kind: 'product' }] })
  m.key.mockResolvedValue({ key: 'private-provider-key', source: 'platform' }); m.budget.mockResolvedValue(null)
  m.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hola {{1}}, conoce nuestro producto.' }] })
})
describe('editable business-grounded template drafts', () => {
  it('only generates a draft using the current business, returning source labels and no provider secrets', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store')
    const data = await response.json(); expect(data.body_text).toBe('Hola {{1}}, conoce nuestro producto.'); expect(data.sources[0].label).toBe('Serum')
    expect(m.key).toHaveBeenCalledWith(ctx.db, { workspaceId }); expect(m.budget).toHaveBeenCalledWith(workspaceId, 'standard')
    expect(m.context).toHaveBeenCalledWith(ctx.db, workspaceId, expect.objectContaining({ product_id: productId }))
    expect(JSON.stringify(m.create.mock.calls[0][0])).toContain('complete offer conditions')
    expect(JSON.stringify(data)).not.toContain('private-provider-key'); expect(JSON.stringify(m.create.mock.calls[0][0])).not.toContain('private-provider-key')
    expect(m.create.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
  it('supports the original brief-only request without requiring a product', async () => {
    expect((await POST(request({ product_id: undefined, tone: 'Friendly' }))).status).toBe(200)
  })
  it.each([{ brief: '' }, { brief: 'x'.repeat(2001) }, { category: 'unknown' }, { language: 'es\nprivate' }, { product_id: 'wrong' }, { workspace_id: 'other' }])('rejects malformed input before spending (%j)', async input => {
    expect((await POST(request(input))).status).toBe(400); expect(m.create).not.toHaveBeenCalled(); expect(m.key).not.toHaveBeenCalled()
  })
  it('blocks CSRF and missing membership before any source access or inference', async () => {
    m.csrf.mockResolvedValue(new Response(null, { status: 403 })); expect((await POST(request())).status).toBe(403)
    expect(m.session).not.toHaveBeenCalled(); m.csrf.mockResolvedValue(null); m.session.mockResolvedValue({ response: new Response(null, { status: 401 }) })
    expect((await POST(request())).status).toBe(401); expect(m.context).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled()
  })
  it('requires current source access, a provider key and AI budget', async () => {
    m.context.mockRejectedValueOnce(new Error('template_draft_context_invalid')); expect((await POST(request())).status).toBe(404)
    m.key.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(503)
    m.budget.mockResolvedValueOnce(new Response(null, { status: 402 })); expect((await POST(request())).status).toBe(402)
    expect(m.create).not.toHaveBeenCalled()
  })
  it('discards a draft if the business, membership or source version changed during inference', async () => {
    m.session.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ ...ctx, workspaceId: 'other' }); expect((await POST(request())).status).toBe(409)
    m.session.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ response: new Response(null, { status: 403 }) }); expect((await POST(request())).status).toBe(403)
    m.context.mockResolvedValueOnce({ text: 'before', fingerprint: 'before', sources: [] }).mockResolvedValueOnce({ text: 'after', fingerprint: 'after', sources: [] })
    expect((await POST(request())).status).toBe(409)
  })
  it('rejects empty, malformed, oversized and token-truncated output without publishing anything', async () => {
    for (const output of ['', '{{2}}', 'x'.repeat(1025)]) {
      m.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: output }] })
      const response = await POST(request()); expect(response.status).toBe(502); expect(await response.json()).not.toHaveProperty('body_text')
    }
    m.create.mockResolvedValueOnce({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Complete-looking text with lost conditions' }] }); expect((await POST(request())).status).toBe(502)
  })
  it('redacts recognizable secrets from the brief and output and hides provider error details', async () => {
    m.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'api_key="private-output"' }] })
    const response = await POST(request({ brief: 'api_key="private-brief"' })); expect(JSON.stringify(await response.json())).not.toContain('private-output')
    expect(JSON.stringify(m.create.mock.calls[0][0])).not.toContain('private-brief')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try { m.create.mockRejectedValueOnce(new Error('private-provider-detail')); const failed = await POST(request()); expect(failed.status).toBe(500); expect(JSON.stringify(await failed.json())).not.toContain('private-provider-detail') } finally { warn.mockRestore() }
  })
  it('blocks recognized unsupported amounts for a selected product and never infers a missing currency', async () => {
    const source = { text: 'Price: 40 USD', fingerprint: 'snapshot', sources: [], pricePolicy: { currency: 'USD', amounts: [40] } }
    m.context.mockResolvedValue(source)
    m.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Por $35 USD.' }] }); expect((await POST(request())).status).toBe(502)
    m.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Por $40 USD.' }] }); expect((await POST(request())).status).toBe(200)
    m.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Por 40 EUR.' }] }); expect((await POST(request())).status).toBe(502)
    m.context.mockResolvedValue({ ...source, pricePolicy: { currency: null, amounts: [40] } })
    m.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Por $40.' }] }); expect((await POST(request())).status).toBe(502)
  })
})
