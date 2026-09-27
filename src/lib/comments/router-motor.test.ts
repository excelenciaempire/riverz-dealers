/* eslint-disable @typescript-eslint/no-explicit-any -- doble de Supabase */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  motorApagado: true,
  reglas: vi.fn(async () => false),
  agente: vi.fn(async () => undefined),
  inserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/workspaces/motor', () => ({ motorApagado: async () => m.motorApagado }))
vi.mock('@/lib/comment-to-dm/engine', () => ({ processCommentForDmRules: m.reglas }))
vi.mock('@/lib/instagram-agent/realtime', () => ({ maybeInstantOutreach: m.agente }))
vi.mock('@/lib/instagram-agent/controls', () => ({
  loadCommentSettings: async () => ({ instagram: true, facebook: true, tiktok: false }),
}))
vi.mock('@/lib/channels/publicacion-media', () => ({ anotarPublicacion: async () => undefined }))
vi.mock('@/lib/comments/hilo', () => ({ loadCommentConversation: async () => ({ id: 'hilo-1' }) }))
vi.mock('@/lib/billing/contact-cap', () => ({ puedeAtenderContacto: async () => true }))
vi.mock('@/lib/ai/desenlace', () => ({ aplicarDesenlace: async () => undefined }))

import { routeComment } from './router'

const db = {
  from: () => ({
    insert: async (row: Record<string, unknown>) => {
      m.inserts.push(row)
      return { error: null }
    },
  }),
} as any

const evento = {
  workspaceId: 'w',
  channel: 'ig_comment' as const,
  connection: { id: 'c' } as any,
  contact: { id: 'ct', external_id: 'ig-1', name: 'Ana' },
  commentId: 'cm-1',
  postId: 'p-1',
  parentCommentId: null,
  text: '¿Precio?',
}

describe('routeComment con el motor apagado', () => {
  beforeEach(() => {
    m.inserts.length = 0
    m.reglas.mockClear()
    m.agente.mockClear()
  })

  it('no contesta ni por regla ni por la IA, y deja el motivo', async () => {
    m.motorApagado = true
    await routeComment(db, evento)
    expect(m.reglas).not.toHaveBeenCalled()
    expect(m.agente).not.toHaveBeenCalled()
    expect(m.inserts).toEqual([
      expect.objectContaining({ conversation_id: 'hilo-1', status: 'skipped', skip_reason: 'motor_apagado' }),
    ])
  })

  it('con el motor encendido sigue el camino de siempre', async () => {
    m.motorApagado = false
    await routeComment(db, evento)
    expect(m.reglas).toHaveBeenCalledOnce()
    expect(m.agente).toHaveBeenCalledOnce()
  })

  it('ignora comentarios eliminados sin gastar IA ni crear alertas', async () => {
    m.motorApagado = false
    await routeComment(db, { ...evento, text: '[deleted]' })
    expect(m.reglas).not.toHaveBeenCalled()
    expect(m.agente).not.toHaveBeenCalled()
    expect(m.inserts).toEqual([])
  })
})
