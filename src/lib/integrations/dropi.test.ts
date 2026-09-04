import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'dropi-key' }))

import { pushOrderToDropi } from './dropi'

function fakeDb(updates: Array<Record<string, unknown>>): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: {
        api_key_encrypted: 'encrypted',
        status: 'connected',
        config: { base_url: 'https://dropi.test', orders_path: '/orders' },
      },
    }),
    update: (patch: Record<string, unknown>) => {
      updates.push(patch)
      return chain
    },
  }
  return { from: () => chain } as unknown as SupabaseClient
}

describe('Dropi delivery health', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('persiste el fallo para que el administrador pueda verlo', async () => {
    const updates: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))

    const sent = await pushOrderToDropi(fakeDb(updates), 'ws-1', { order_name: '1001' })

    expect(sent).toBe(false)
    expect(updates.at(-1)?.config).toMatchObject({ last_error: 'HTTP 503' })
  })

  it('limpia la señal cuando el siguiente envío termina bien', async () => {
    const updates: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 201 })))

    const sent = await pushOrderToDropi(fakeDb(updates), 'ws-1', { order_name: '1001' })

    expect(sent).toBe(true)
    expect(updates.at(-1)?.config).toMatchObject({
      last_error: null,
      last_error_at: null,
    })
  })
})
