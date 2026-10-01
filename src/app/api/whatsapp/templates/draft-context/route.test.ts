import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), filters: [] as unknown[][], products: [] as Record<string, unknown>[], agents: [] as Record<string, unknown>[], error: null as unknown }))
vi.mock('@/lib/inbox/server-context', () => ({ inboxSession: m.session }))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }))
import { GET } from './route'
const db = { from(table: string) {
  const q = { select: (...v: unknown[]) => { m.filters.push([table, 'select', ...v]); return q }, eq: (...v: unknown[]) => { m.filters.push([table, ...v]); return q },
    order: () => q, ilike: (...v: unknown[]) => { m.filters.push([table, 'ilike', ...v]); return q }, limit: (...v: unknown[]) => { m.filters.push([table, 'limit', ...v]); return q },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === 'shopify_products' ? m.products : m.agents, error: m.error }).then(resolve) }
  return q
} }
const ctx = { db, userId: 'user', workspaceId: 'workspace' }
const request = (q = '') => new Request('https://riverz.co/api/whatsapp/templates/draft-context?q=' + encodeURIComponent(q))
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue(ctx); m.filters = []; m.products = [{ id: 'p', title: 'Serum', training_material: 'private-training' }]; m.agents = [{ id: 'a', name: 'Business', knowledge: 'private-profile' }]; m.error = null })
describe('draft context choices', () => {
  it('returns only names and IDs from the current business, with escaped search', async () => {
    const response = await GET(request('50%_'))
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ products: [{ id: 'p', label: 'Serum' }], agents: [{ id: 'a', label: 'Business' }], has_more: false })
    expect(m.filters).toContainEqual(['shopify_products', 'workspace_id', 'workspace'])
    expect(m.filters).toContainEqual(['ai_agents', 'workspace_id', 'workspace'])
    expect(m.filters).toContainEqual(['ai_agents', 'is_active', true])
    expect(m.filters).toContainEqual(['shopify_products', 'ilike', 'title', String.raw`%50\%\_%`])
  })
  it('declares partial product results so search can reach the rest', async () => {
    m.products = Array.from({ length: 51 }, (_, i) => ({ id: String(i), title: String(i) }))
    const data = await (await GET(request())).json(); expect(data.products).toHaveLength(50); expect(data.has_more).toBe(true)
  })
  it('does not expose names after membership or business changes during loading', async () => {
    m.session.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ ...ctx, workspaceId: 'other' }); expect((await GET(request())).status).toBe(409)
    m.session.mockResolvedValueOnce(ctx).mockResolvedValueOnce({ response: new Response(null, { status: 403 }) }); expect((await GET(request())).status).toBe(403)
  })
  it('blocks missing session, oversized search and database errors', async () => {
    m.session.mockResolvedValueOnce({ response: new Response(null, { status: 401 }) }); expect((await GET(request())).status).toBe(401); expect(m.filters).toEqual([])
    expect((await GET(request('x'.repeat(101)))).status).toBe(400)
    m.error = { message: 'private' }; const response = await GET(request()); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('private')
  })
})
