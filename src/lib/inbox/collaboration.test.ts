import { describe, expect, it } from 'vitest'
import { collaborationAction, noteCursor } from './collaboration'
import { conversationMatchesView, savedViewConfig } from './saved-views'
import type { Conversation } from '@/types'

const id = '11111111-1111-4111-8111-111111111111'
describe('private collaboration input', () => {
  it('accepts an internal note with an idempotency ID and deduplicated mentions', () => {
    expect(collaborationAction({ action: 'note', id, body: '  Revisar dirección  ', mentions: [id, id] })).toEqual({ action: 'note', id, body: 'Revisar dirección', mentions: [id] })
  })
  it.each([null, [], { action: 'send', body: 'Hello' }, { action: 'note', id, body: '', mentions: [] },
    { action: 'note', id, body: 'x'.repeat(5001), mentions: [] }, { action: 'note', id, body: 'valid', mentions: ['forged'] },
    { action: 'presence', session_id: id, composing: 'false' }, { action: 'case', priority: 'admin', reason: 'payment' }])('rejects malformed action %j', raw => {
    expect(collaborationAction(raw)).toBeNull()
  })
  it('rejects injected pagination syntax while preserving timestamp precision', () => {
    expect(noteCursor(`2026-09-29T12:00:00.123456+00:00|${id}`)).toEqual({ date: '2026-09-29T12:00:00.123456+00:00', id })
    expect(noteCursor(`2026-09-29T12:00:00Z,or(id.gt.0)|${id}`)).toBeNull()
    expect(noteCursor(`2026-09-29T12:00:00Z|${id}|extra`)).toBeNull()
  })
})
describe('case views', () => {
  const conversation = { channel: 'whatsapp', status: 'pending', assigned_agent_id: id, unread_count: 2, last_sender_type: 'customer', case_priority: 'urgent', case_reason: 'delivery' } as Conversation
  it('combines assignee, channel, state, priority and reason', () => {
    expect(conversationMatchesView(conversation, { channel: 'whatsapp', status: 'mine', case_priority: 'urgent', case_reason: 'delivery' }, id)).toBe(true)
    expect(conversationMatchesView(conversation, { status: 'mine' }, 'another-user')).toBe(false)
    expect(conversationMatchesView(conversation, { status: 'unassigned' }, id)).toBe(false)
    expect(conversationMatchesView(conversation, { case_reason: 'payment' }, id)).toBe(false)
  })
  it('does not call a conversation unread after the team already replied', () => {
    expect(conversationMatchesView({ ...conversation, last_sender_type: 'agent' }, { status: 'unread' }, id)).toBe(false)
    expect(conversationMatchesView(conversation, { status: 'unread' }, id)).toBe(true)
  })
  it('preserves unsupported legacy configs rather than counting them as an unrestricted view', () => {
    expect(savedViewConfig({ tag_ids: [id], q: 'old query' })).toBeNull()
    expect(savedViewConfig({ channel: 'whatsapp', case_reason: 'delivery' })).toEqual({ channel: 'whatsapp', case_reason: 'delivery' })
    expect(savedViewConfig({ channel: 'bogus' })).toBeNull()
    expect(savedViewConfig({ status: 'unassigned', assigned_agent_id: id })).toBeNull()
  })
})
