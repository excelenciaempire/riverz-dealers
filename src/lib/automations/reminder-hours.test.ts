import { describe, expect, it } from 'vitest'
import { nextReminderTime } from './reminder-hours'

const config = { reminder_hours: { start: 6, end: 1, timezone: 'America/Bogota' } }

describe('reminder hours in Colombia', () => {
  it.each([
    ['2026-09-13T05:47:35.413Z', '2026-09-13T05:47:35.413Z'],
    ['2026-09-13T05:59:59.999Z', '2026-09-13T05:59:59.999Z'],
    ['2026-09-13T06:00:00.000Z', '2026-09-13T11:00:00.000Z'],
    ['2026-09-13T08:30:00.000Z', '2026-09-13T11:00:00.000Z'],
    ['2026-09-13T10:59:59.999Z', '2026-09-13T11:00:00.000Z'],
    ['2026-09-13T11:00:00.000Z', '2026-09-13T11:00:00.000Z'],
    ['2026-09-14T04:30:00.000Z', '2026-09-14T04:30:00.000Z'],
  ])('schedules %s as %s', (input, expected) => {
    expect(nextReminderTime(new Date(input), config).toISOString()).toBe(expected)
  })

  it('leaves other automations unchanged', () => {
    const date = new Date('2026-09-13T08:00:00Z')
    expect(nextReminderTime(date, {})).toBe(date)
  })

  it('supports daytime windows across month boundaries', () => {
    expect(nextReminderTime(new Date('2026-10-01T03:00:00Z'), {
      reminder_hours: { start: 6, end: 18, timezone: 'America/Bogota' },
    }).toISOString()).toBe('2026-10-01T11:00:00.000Z')
  })

  it('fails closed for invalid configuration', () => {
    expect(() => nextReminderTime(new Date(), {
      reminder_hours: { start: 30, end: 1, timezone: 'America/Bogota' },
    })).toThrow('Invalid reminder_hours')
  })
})
