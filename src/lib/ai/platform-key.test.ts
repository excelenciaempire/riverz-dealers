import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => {
  // Una base de mentira: cada tabla devuelve sus filas a cualquier consulta.
  const fake = (rows: Record<string, unknown>) => ({
    from: (table: string) => {
      const result = { data: rows[table] ?? null, error: rows['error:'+table] ?? null }
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'not', 'order', 'limit']) q[m] = () => q
      q.maybeSingle = async () => result
      q.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve)
      return q
    },
  })
  return { fake, servicio: { rows: {} as Record<string, unknown> } }
})

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => h.fake(h.servicio.rows) }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v.replace(/^enc:/, '') }))

import { claveRechazada, invalidatePlatformKeyCache, resolveAnthropicKey } from './platform-key'

/**
 * Distinguir "esta clave no sirve" de "el modelo falló" es lo que decide si
 * reintentar con otra clave o rendirse. Los casos de acá son errores reales
 * copiados de `ai_replies` en producción.
 */
describe('claveRechazada', () => {
  it('reconoce la clave revocada (401)', () => {
    expect(
      claveRechazada({
        status: 401,
        message:
          '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      }),
    ).toBe(true)
  })

  it('reconoce el saldo agotado, que llega como 400 y no como 402', () => {
    // El caso que dejó a un comercio dos semanas sin respuestas automáticas:
    // mirando sólo el código HTTP es indistinguible de un pedido mal armado.
    expect(
      claveRechazada({
        status: 400,
        message:
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API"}}',
      }),
    ).toBe(true)
  })

  it('no reintenta cuando el modelo está saturado', () => {
    expect(claveRechazada({ status: 429, message: '429 rate_limit_error' })).toBe(
      false,
    )
    expect(claveRechazada({ status: 529, message: '529 overloaded_error' })).toBe(
      false,
    )
  })

  it('no reintenta ante un 400 que sí es culpa del pedido', () => {
    expect(
      claveRechazada({
        status: 400,
        message:
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: must be greater than 0"}}',
      }),
    ).toBe(false)
  })

  it('aguanta lo que no es un error del SDK', () => {
    expect(claveRechazada(null)).toBe(false)
    expect(claveRechazada('boom')).toBe(false)
    expect(claveRechazada(new Error('socket hang up'))).toBe(false)
  })
})

describe('resolveAnthropicKey con cuentas BYOK', () => {
  // La base de quien llama: modo "todos" y una clave de Riverz cargada.
  const db = h.fake({
    platform_ai_settings: { mode: 'all', anthropic_key_encrypted: 'enc:sk-riverz' },
  }) as unknown as SupabaseClient

  beforeEach(() => {
    invalidatePlatformKeyCache()
    process.env.ANTHROPIC_API_KEY = 'sk-entorno'
    h.servicio.rows = {}
  })

  it('usa la clave que el comercio cargó en su agente', async () => {
    h.servicio.rows = {
      workspace_subscriptions: { modelo_cobro: 'byok' },
      ai_agents: [{ api_key_encrypted: 'enc:sk-comercio' }],
    }
    await expect(resolveAnthropicKey(db, { workspaceId: 'w1' }))
      .resolves.toEqual({ key: 'sk-comercio', source: 'agent' })
  })

  it('sin su clave no responde: ni la de Riverz ni la del entorno', async () => {
    h.servicio.rows = { workspace_subscriptions: { modelo_cobro: 'byok' }, ai_agents: [] }
    await expect(resolveAnthropicKey(db, { workspaceId: 'w1' })).resolves.toBeNull()
  })

  it('aplica cambios de modelo entre peticiones sin reiniciar ni invalidar otra instancia', async () => {
    h.servicio.rows = { workspace_subscriptions: { modelo_cobro: 'oficial' }, ai_agents: [] }
    await expect(resolveAnthropicKey(db, { workspaceId: 'w1' }))
      .resolves.toEqual({ key: 'sk-riverz', source: 'platform' })
    h.servicio.rows.workspace_subscriptions = { modelo_cobro: 'byok' }
    await expect(resolveAnthropicKey(db, { workspaceId: 'w1' })).resolves.toBeNull()
    h.servicio.rows.workspace_subscriptions = { modelo_cobro: 'saldo' }
    await expect(resolveAnthropicKey(db, { workspaceId: 'w1' }))
      .resolves.toEqual({ key: 'sk-riverz', source: 'platform' })
  })

  it('la clave del agente manda aunque la cuenta sea BYOK', async () => {
    h.servicio.rows = { workspace_subscriptions: { modelo_cobro: 'byok' } }
    await expect(resolveAnthropicKey(db, { workspaceId: 'w1', agentKeyEncrypted: 'enc:sk-agente' }))
      .resolves.toEqual({ key: 'sk-agente', source: 'agent' })
  })

  it('una cuenta con saldo o con plan sigue cubierta por la clave de Riverz', async () => {
    h.servicio.rows = { workspace_subscriptions: { modelo_cobro: 'saldo' } }
    await expect(resolveAnthropicKey(db, { workspaceId: 'w1' }))
      .resolves.toEqual({ key: 'sk-riverz', source: 'platform' })
  })
  it('does not fall back to Riverz when the billing model cannot be verified', async () => {
    h.servicio.rows = { 'error:workspace_subscriptions': { message: 'unavailable' } };
    await expect(resolveAnthropicKey(db, { workspaceId: 'w1' })).rejects.toThrow('billing_model_unavailable');
  });
})
