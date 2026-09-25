import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ byok: true }))
vi.mock('./platform-key', () => ({ esCuentaByok: async () => h.byok }))

import { completeTextConUso } from './llm-client'

describe('proveedores de respaldo', () => {
  const fetchOriginal = globalThis.fetch

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'gsk-riverz'
  })
  afterEach(() => {
    delete process.env.GROQ_API_KEY
    globalThis.fetch = fetchOriginal
  })

  it('no atienden a una cuenta BYOK: esos los paga Riverz', async () => {
    const fetch = vi.fn()
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch
    await expect(completeTextConUso({
      billing: { db: {} as SupabaseClient, workspaceId: 'w1', concepto: 'ia_clasificacion' },
      tier: 'triage',
      system: 'Clasifica.',
      user: 'hola',
      maxTokens: 10,
      anthropicKey: null,
    })).rejects.toThrow('No LLM provider available')
    expect(fetch).not.toHaveBeenCalled()
  })
})
