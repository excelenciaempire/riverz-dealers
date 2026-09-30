import { isDue } from '@/lib/cron/schedule'

const LIMITS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] as const

/** The builder and the worker accept the same bounded, five-field cron syntax. */
export function validAutomationSchedule(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const schedule = raw.trim()
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule)) return true
  const fields = schedule.split(/\s+/)
  return fields.length === 5 && fields.every((field, i) => field.split(',').every(part => {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!match) return false
    const [, range, step] = match
    const [min, max] = LIMITS[i]
    if (step !== undefined && (!Number.isSafeInteger(Number(step)) || Number(step) < 1 || Number(step) > max - min + 1)) return false
    if (range === '*') return true
    const values = range.split('-').map(Number)
    if (step !== undefined && values.length !== 2) return false
    return values.every(n => n >= min && n <= max) && (values.length === 1 || values[0] <= values[1])
  }))
}

export function validAutomationTimezone(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw.trim()) return false
  try { new Intl.DateTimeFormat('en', { timeZone: raw }).format(); return true } catch { return false }
}

/** Local wall-clock slots deduplicate the repeated hour when daylight saving ends. */
export function automationScheduleSlot(schedule: unknown, timezone: string, at: Date): string | null {
  if (!validAutomationSchedule(schedule) || !validAutomationTimezone(timezone) || !Number.isFinite(at.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)
  const p = Object.fromEntries(parts.map(v => [v.type, v.value]))
  const wall = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
  const cron = schedule.trim().includes(':')
    ? `${Number(schedule.trim().slice(3))} ${Number(schedule.trim().slice(0, 2))} * * *`
    : schedule
  return isDue(cron, new Date(`${wall}:00Z`)) ? `${timezone}:${wall}` : null
}
