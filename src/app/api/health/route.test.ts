import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  abortSignal: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        limit: () => ({ abortSignal: mocks.abortSignal }),
      }),
    }),
  }),
}))

vi.mock('@/lib/log/logger', () => ({
  getLogger: () => ({ warn: mocks.warn }),
}))

import { GET } from './route'

afterEach(() => {
  vi.unstubAllGlobals()
  mocks.abortSignal.mockReset()
  mocks.warn.mockReset()
})

describe('GET /api/health', () => {
  it('limita la consulta a Supabase y responde como sonda de vida', async () => {
    mocks.abortSignal.mockResolvedValue({ error: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: 'ok',
      checks: { supabase: 'ok', whatsapp: 'ok' },
    })
    expect(mocks.abortSignal).toHaveBeenCalledOnce()
    expect(mocks.abortSignal.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)
  })

  it('reporta una dependencia caída sin tumbar la instancia saludable', async () => {
    mocks.abortSignal.mockResolvedValue({ error: { message: 'timeout' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }))

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      status: 'down',
      checks: { supabase: 'down', whatsapp: 'ok' },
    })
  })

  it('no queda esperando si el cliente de Supabase ignora el aborto', async () => {
    vi.useFakeTimers()
    mocks.abortSignal.mockReturnValue(new Promise(() => undefined))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }))

    const pendiente = GET()
    await vi.advanceTimersByTimeAsync(2_000)
    const response = await pendiente
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ status: 'down', checks: { supabase: 'down' } })
    vi.useRealTimers()
  })
})
