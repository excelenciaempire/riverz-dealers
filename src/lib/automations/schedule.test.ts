import { describe, expect, it } from 'vitest'
import { automationScheduleSlot, validAutomationSchedule } from './schedule'
import { validateTriggerForActivation } from './validate'
import { matchesEventConfig } from './event-entries'

describe('automation event configuration', () => {
  it.each(['09:30', '23:59', '*/15 * * * *', '0 8 * * 1-5', '0 8 1,15 * *', '0 8 * * 7'])('accepts %s', value => {
    expect(validAutomationSchedule(value)).toBe(true)
    expect(validateTriggerForActivation('time_based', { schedule: value })).toEqual([])
  })
  it.each(['', '24:00', '9:30', '60 * * * *', '0 24 * * *', '*/0 * * * *', '*/999 * * * *', '5/10 * * * *', '0 8 * * 9', '0 8 0 * *', '0 8 * 13 *', '0 8 * * 4-2', '0 8 * * 1,,2'])('rejects %s', value => {
    expect(validAutomationSchedule(value)).toBe(false)
    expect(validateTriggerForActivation('time_based', { schedule: value })).not.toEqual([])
  })
  it('uses the business clock instead of the server clock', () => {
    const at = new Date('2026-09-29T14:30:00Z')
    expect(automationScheduleSlot('09:30', 'America/Bogota', at)).toBe('America/Bogota:2026-09-29T09:30')
    expect(automationScheduleSlot('09:30', 'UTC', at)).toBeNull()
    expect(automationScheduleSlot('0 8 * * *', 'bad/timezone', at)).toBeNull()
    expect(validateTriggerForActivation('time_based', { schedule: '09:30', timezone: 'bad/timezone' })).toHaveLength(1)
  })
  it('gives the repeated daylight-saving hour the same slot', () => {
    const first = automationScheduleSlot('01:30', 'America/New_York', new Date('2026-11-01T05:30:00Z'))
    const second = automationScheduleSlot('01:30', 'America/New_York', new Date('2026-11-01T06:30:00Z'))
    expect(first).toBeTruthy()
    expect(first).toBe(second)
  })
  it('matches only the exact tag added', () => {
    expect(matchesEventConfig('tag_added', { tag_id: 'a' }, { tag_id: 'b' })).toBe(false)
    expect(matchesEventConfig('tag_added', { tag_id: 'a' }, { tag_id: 'a' })).toBe(true)
    expect(matchesEventConfig('tag_added', {}, {})).toBe(false)
  })
})
