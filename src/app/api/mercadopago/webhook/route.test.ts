import { createHmac } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), notify: vi.fn() }))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/mercadopago/notify', () => ({
  handlePaymentNotification: mocks.notify, isPaymentTopic: (kind: string) => kind === 'payment',
}))
vi.mock('@/lib/log/logger', () => ({ getLogger: () => ({ captureException: vi.fn() }) }))
import { GET, POST } from './route'

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
it('rejects unsigned requests before accessing merchant data', async () => {
  vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'test-secret')
  const res = await POST(new Request('https://riverz.co/api/mercadopago/webhook', {
    method: 'POST', body: JSON.stringify({ type: 'payment', user_id: 9 }),
  }))
  expect(res.status).toBe(401)
  expect(mocks.admin).not.toHaveBeenCalled()
  expect(mocks.notify).not.toHaveBeenCalled()
})
it('fails closed when the signature secret is absent', async () => {
  vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', '')
  expect((await POST(new Request('https://riverz.co/api/mercadopago/webhook'))).status).toBe(503)
  expect(mocks.admin).not.toHaveBeenCalled()
})
it('processes a signed notification for its seller', async () => {
  vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'test-secret')
  mocks.admin.mockReturnValue('db')
  mocks.notify.mockResolvedValue({ ok: true, disconnected: true })
  const hash = createHmac('sha256', 'test-secret')
    .update('id:123456;request-id:test-request;ts:1704908010;').digest('hex')
  const res = await POST(new Request('https://riverz.co/api/mercadopago/webhook?data.id=123456', {
    method: 'POST',
    headers: { 'x-request-id': 'test-request', 'x-signature': `ts=1704908010,v1=${hash}` },
    body: JSON.stringify({ type: 'payment', user_id: 9 }),
  }))
  expect(res.status).toBe(200)
  expect(mocks.notify).toHaveBeenCalledWith('db', '9', '123456')
})
it('keeps the provider URL validation available without processing payments', () => {
  expect(GET().status).toBe(200)
  expect(mocks.notify).not.toHaveBeenCalled()
})
