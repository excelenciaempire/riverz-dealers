import { beforeEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const state = vi.hoisted(() => ({ run: vi.fn(), append: vi.fn(), history: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) } }) }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/workspaces/resolve', () => ({ resolveWorkspaceIdForUser: async () => 'workspace' }))
vi.mock('@/lib/admin/feature-flags', () => ({ getFeatureFlags: async () => ({}), isRiverz2: () => true, isOperatorFleet: () => true }))
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ limitByKey: async () => ({ success: true }) }))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }))
vi.mock('@/lib/wallet/puerta', () => ({ puertaDeIa: async () => ({ puede: true }) }))
vi.mock('@/lib/operator/loop', () => ({ runOperator: state.run }))
vi.mock('@/lib/operator/corridas', () => ({
  abrirCorrida: async () => ({ id: 'run', yaHabia: false }),
  cerrarCorrida: async () => {}, pidieronDetener: async () => false,
  latido: () => ({ ver: async () => {} }),
}))
vi.mock('@/lib/operator/threads', async (original) => ({
  ...await original<typeof import('@/lib/operator/threads')>(),
  ensureThread: async () => 'thread', loadMessages: state.history, appendMessage: state.append,
}))
import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  state.history.mockResolvedValue([])
  state.append.mockResolvedValue(undefined)
  state.run.mockResolvedValue({ text: 'I see the image.', promptTokens: 1, completionTokens: 1, costoUsd: 0, proposedIds: [] })
})

it('accepts an image-only turn, persists normalized pixels and sends them to the model', async () => {
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'blue' } }).png().toBuffer()
  const response = await POST(new Request('https://riverz.co/api/operacion/operator', {
    method: 'POST', body: JSON.stringify({ images: [{ name: 'blue.png', data: bytes.toString('base64') }] }),
  }))
  expect(response.status).toBe(200)
  await response.text()
  const saved = state.append.mock.calls[0][1]
  expect(saved.workspaceId).toBe('workspace')
  expect(saved.images[0].mediaType).toBe('image/jpeg')
  expect(state.run.mock.calls[0][0].history[0].content[0]).toEqual({
    type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: saved.images[0].data },
  })
})

it('rejects invalid image data before persistence or model execution', async () => {
  const response = await POST(new Request('https://riverz.co/api/operacion/operator', {
    method: 'POST', body: JSON.stringify({ texto: 'Read it', images: [{ data: 'invalid' }] }),
  }))
  expect(response.status).toBe(400)
  expect((await response.json()).error).toContain('Attach up to 3')
  expect(state.run).not.toHaveBeenCalled()
  expect(state.append).not.toHaveBeenCalled()
})
