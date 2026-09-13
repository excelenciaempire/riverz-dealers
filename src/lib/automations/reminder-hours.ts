import { fromZonedTime, toZonedTime } from 'date-fns-tz'

/** Optional automation policy, applied only to delayed continuations. */
export function nextReminderTime(date: Date, config: object): Date {
  const hours = (config as Record<string, unknown>).reminder_hours as
    | { start: number; end: number; timezone: string }
    | undefined
  if (!hours) return date
  const { start, end, timezone } = hours
  if (!Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || start > 23 || end < 0 || end > 23 || !timezone) {
    throw new Error('Invalid reminder_hours')
  }
  const local = toZonedTime(date, timezone)
  if (Number.isNaN(local.getTime())) throw new Error('Invalid reminder timezone')
  const hour = local.getHours()
  const allowed = start === end || (start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end)
  if (allowed) return date
  if (start < end && hour >= end) local.setDate(local.getDate() + 1)
  local.setHours(start, 0, 0, 0)
  return fromZonedTime(local, timezone)
}
