import { describe, expect, it } from 'vitest'
import { followupDate, inboxActions, conversationIsSnoozed } from './case-actions'
import { inboxShortcut } from './shortcuts'
import { bulkCaseIds, bulkCaseRunId } from './bulk-actions'

const now = Date.parse('2026-01-01T00:00:00Z')
const id = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
describe('human follow-up commands', () => {
  it('requires explicit instants and rejects normalized invalid calendar dates', () => {
    for (const date of ['2026-02-31T12:00:00Z', '2026-02-29T12:00:00Z', '2026-01-02T24:00:00Z', '2026-01-02T12:00:00', '2025-12-31T12:00:00Z', '2027-01-02T12:00:00Z']) {
      expect(followupDate(date, now)).toBeNull()
    }
    expect(followupDate('2026-01-02T07:30:00-05:00', now)).toBe('2026-01-02T12:30:00.000Z')
    expect(followupDate('2026-04-31T12:00:00Z', now)).toBeNull()
  })
  it('rejects customer sends, hidden fields and invalid or empty commands', () => {
    for (const commands of [[], [{ type: 'send_message', body: 'hi' }], [{ type: 'resume', workspace_id: id }], [{ type: 'note', body: ' ', mentions: [] }], Array(11).fill({ type: 'resume' })]) {
      expect(inboxActions(commands)).toBeNull()
    }
  })
  it('keeps relative macro time separate from manual deadlines', () => {
    expect(inboxActions([{ type: 'reminder', minutes: 60, body: ' Call ' }], { macro: true })).toEqual([{ type: 'reminder', minutes: 60, body: 'Call' }])
    expect(inboxActions([{ type: 'snooze', minutes: 60 }], { now })).toBeNull()
    expect(inboxActions([{ type: 'snooze', until: '2026-01-02T00:00:00Z' }], { macro: true })).toBeNull()
    expect(inboxActions([{ type: 'reminder', minutes: 43201, body: 'Call' }], { macro: true })).toBeNull()
  })
  it('bounds assignment and requires an exclusive team or candidate list', () => {
    expect(inboxActions([{ type: 'assign', team_id: id, agent_ids: [other] }])).toBeNull()
    expect(inboxActions([{ type: 'assign', agent_ids: [] }])).toBeNull()
    expect(inboxActions([{ type: 'assign', agent_ids: [id, id] }])).toEqual([{ type: 'assign', agent_ids: [id] }])
  })
  it('deduplicates mentions and recognizes only future snoozes', () => {
    expect(inboxActions([{ type: 'note', body: 'Note', mentions: [id, id] }])).toEqual([{ type: 'note', body: 'Note', mentions: [id] }])
    expect(conversationIsSnoozed({ snoozed_until: '2026-01-02T00:00:00Z' }, now)).toBe(true)
    expect(conversationIsSnoozed({ snoozed_until: 'bad' }, now)).toBe(false)
  })
})
describe('explicit bulk scope and retries', () => {
  it('accepts only bounded explicit case IDs', () => {
    expect(bulkCaseIds([other, id, id])).toEqual([id, other])
    for (const value of [[], ['all'], { channel: 'whatsapp' }, Array(101).fill(id)]) expect(bulkCaseIds(value)).toBeNull()
  })
  it('keeps a retry stable and separates cases and operations', () => {
    expect(bulkCaseRunId(id, other)).toBe(bulkCaseRunId(id, other))
    expect(bulkCaseRunId(id, id)).not.toBe(bulkCaseRunId(id, other))
    expect(bulkCaseRunId(other, id)).not.toBe(bulkCaseRunId(id, id))
  })
})
describe('safe navigation shortcuts', () => {
  const event = { altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'KeyJ', defaultPrevented: false }
  it('does not capture typing, system shortcuts or handled events', () => {
    expect(inboxShortcut(event, true)).toBeNull()
    for (const patch of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: false }, { defaultPrevented: true }]) expect(inboxShortcut({ ...event, ...patch }, false)).toBeNull()
  })
  it('only navigates or focuses; no action shortcut can send or delete', () => {
    expect(inboxShortcut(event, false)).toBe('next')
    expect(inboxShortcut({ ...event, code: 'KeyK' }, false)).toBe('previous')
    expect(inboxShortcut({ ...event, code: 'KeyR' }, false)).toBe('reply')
    expect(inboxShortcut({ ...event, code: 'KeyF' }, false)).toBe('search')
    expect(inboxShortcut({ ...event, code: 'Enter' }, false)).toBeNull()
    expect(inboxShortcut({ ...event, code: 'Delete' }, false)).toBeNull()
  })
})
