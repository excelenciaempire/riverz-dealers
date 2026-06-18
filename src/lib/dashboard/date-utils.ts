// Centralised date helpers for the dashboard so every chart / card agrees
// on what "today", "day boundary", and "day of week" mean.
//
// Every boundary is computed in the WORKSPACE timezone (the single app
// reporting zone, see migration 072 + useTimezone) — NOT the viewer's
// browser clock. That's why each helper takes an explicit `tz`: a business
// user in Madrid checking a Bogotá workspace must still see the Bogotá
// "today", and two teammates must always agree on the numbers.
//
// Boundary helpers return real UTC instants (Date) so callers can hand them
// straight to PostgREST `.gte('created_at', d.toISOString())`. Key helpers
// return the `tz` calendar date as YYYY-MM-DD for bucketing.

import { fromZonedTime, toZonedTime } from 'date-fns-tz'

/** Wall-clock calendar date (YYYY-MM-DD) of `instant` as seen in `tz`. */
function ymdInTz(tz: string, instant: Date): string {
  // en-CA renders ISO-style YYYY-MM-DD and lets Intl do the tz shift for us,
  // avoiding date-fns format-token edge cases.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** Shift a YYYY-MM-DD string by `deltaDays` calendar days (UTC field math,
 *  immune to the browser's own timezone and to DST in `tz`). */
function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** UTC instant of 00:00 in `tz` on a given YYYY-MM-DD. fromZonedTime applies
 *  the correct offset for that wall-clock moment (DST included). */
function startOfYmd(tz: string, ymd: string): Date {
  return fromZonedTime(`${ymd}T00:00:00`, tz)
}

/** Start of the day (midnight in `tz`) that `instant` falls on, as a UTC
 *  instant. Defaults to "today" in `tz`. */
export function startOfDay(tz: string, instant: Date = new Date()): Date {
  return startOfYmd(tz, ymdInTz(tz, instant))
}

/** Midnight (in `tz`) `days` calendar days ago, as a UTC instant.
 *  daysAgoStart(tz, 0) === start of today in `tz`. */
export function daysAgoStart(tz: string, days: number): Date {
  const today = ymdInTz(tz, new Date())
  return startOfYmd(tz, shiftYmd(today, -days))
}

/** Date-only key (YYYY-MM-DD) for bucketing a row by its `tz` calendar day. */
export function dayKey(tz: string, d: Date | string): string {
  return ymdInTz(tz, typeof d === 'string' ? new Date(d) : d)
}

/**
 * Inclusive list of `tz`-day keys spanning the last `n` days, in
 * chronological order (oldest → today). Used to seed chart buckets so days
 * with zero activity still render a 0-point in the line. Consistent with
 * dayKey: both express the same `tz` calendar date.
 */
export function lastNDayKeys(tz: string, n: number): string[] {
  const today = ymdInTz(tz, new Date())
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i--) keys.push(shiftYmd(today, -i))
  return keys
}

/**
 * ISO day-of-week where 0 = Monday … 6 = Sunday, computed in `tz`.
 * JavaScript's native getDay() uses 0 = Sunday, awkward for business charts.
 */
export function mondayIndex(tz: string, d: Date): number {
  const jsDow = toZonedTime(d, tz).getDay() // 0..6 with Sunday=0, in `tz`
  return (jsDow + 6) % 7
}

export const DOW_SHORT_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
