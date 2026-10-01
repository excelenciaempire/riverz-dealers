import { describe, expect, it } from 'vitest'
import { editableDraft, draftWriteSchema, storedDraftConfig } from './draft'
const segment = '11111111-1111-4111-8111-111111111111'
const base = { name: 'Review', template_name: 'hello', template_language: 'es', audience_filter: { type: 'segment', segmentId: segment }, scheduled_at: '2099-01-01T12:00:00Z', create_conversations: true }
describe('one editable draft for the manual editor, hook and Operator', () => {
  it.each([
    { template_variables: { '1': 'first_name', '2': 'Shipping excluded' }, variable_mapping: { '1': 'first_name' } },
    { template_variables: { '1': '', '2': 'Shipping excluded' }, variable_mapping: { '1': 'first_name' } },
    { template_variables: { '1': { type: 'field', value: 'first_name' }, '2': { type: 'static', value: 'Shipping excluded' } } },
  ])('normalizes the stored formats without losing fixed slots or schedule (%j)', fields => {
    const config = editableDraft({ ...base, ...fields })
    expect(config.variables).toEqual({ '1': { type: 'field', value: 'first_name' }, '2': { type: 'static', value: 'Shipping excluded' } })
    expect(config.scheduled_at).toBe(base.scheduled_at); expect(config.audience_filter.segmentId).toBe(segment)
    expect(storedDraftConfig(config)).toMatchObject({ variable_mapping: { '1': 'first_name' }, create_conversations: true })
    expect(editableDraft(storedDraftConfig(config))).toEqual(config)
  })
  it('keeps exclusion tags and custom field identities', () => {
    expect(editableDraft({ ...base, audience_filter: { ...base.audience_filter, excludeTagIds: [segment] }, variable_mapping: { '1': segment } }).variables['1']).toEqual({ type: 'custom_field', value: segment })
  })
  it.each([{ type: 'csv' }, { type: 'custom_field' }, { type: 'segment' }, { type: 'tags', tagIds: [] }, null])('does not widen an unsupported audience to everyone (%j)', audience_filter => {
    expect(() => editableDraft({ ...base, audience_filter })).toThrow('broadcast_draft_invalid')
  })
  it.each([{ '0': 'text' }, { '01': 'text' }, { '65': 'text' }, { '1': { type: 'field', value: 'unknown' } }])('rejects malformed variables (%j)', template_variables => {
    expect(() => editableDraft({ ...base, template_variables })).toThrow('broadcast_draft_invalid')
  })
  it('requires an exact draft version and rejects caller-controlled destinations or workspace', () => {
    const config = editableDraft({ ...base, template_variables: {} })
    const input = { id: segment, expected_updated_at: '2026-10-01T12:00:00.123456+00:00', config, expected_template: null }
    expect(draftWriteSchema.safeParse(input).success).toBe(true)
    expect(draftWriteSchema.safeParse({ ...input, recipients: [segment] }).success).toBe(false)
    expect(draftWriteSchema.safeParse({ ...input, workspace_id: segment }).success).toBe(false)
  })
})
