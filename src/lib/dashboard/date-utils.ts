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

// ------------------------------------------------------------
// Date-range filter — a single model the whole dashboard agrees on.
// ------------------------------------------------------------

export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

/** A concrete [start, end) instant window. `end` is exclusive. */
export interface DateRange {
  start: Date
  end: Date
}

/**
 * Resolve a preset (or a custom YYYY-MM-DD pair) to a concrete [start, end)
 * window in `tz`. Rolling presets end at `now` so counts include up to the
 * current moment ("contando hasta ahora mismo"); `yesterday` is the whole
 * previous day; `custom` spans whole calendar days (end-day inclusive).
 */
export function rangeForPreset(
  tz: string,
  preset: RangePreset,
  custom?: { start: string; end: string } | null,
): DateRange {
  const now = new Date()
  switch (preset) {
    case 'today':
      return { start: startOfDay(tz, now), end: now }
    case 'yesterday':
      return { start: daysAgoStart(tz, 1), end: startOfDay(tz, now) }
    case '7d':
      // 6 prior days + today (up to now) = 7 calendar days, ending now.
      return { start: daysAgoStart(tz, 6), end: now }
    case '30d':
      return { start: daysAgoStart(tz, 29), end: now }
    case 'custom': {
      if (!custom?.start || !custom?.end) return { start: daysAgoStart(tz, 6), end: now }
      // Normalise so start ≤ end regardless of click order.
      const [a, b] = custom.start <= custom.end ? [custom.start, custom.end] : [custom.end, custom.start]
      // Exclusive end = midnight of the day AFTER the picked end day.
      return { start: startOfYmd(tz, a), end: startOfYmd(tz, shiftYmd(b, 1)) }
    }
  }
}

/**
 * The comparison window for deltas: the equal-length period IMMEDIATELY
 * before `range`. It abuts the current window exactly (prev.end === range.start)
 * with the same duration — so there's never a gap or overlap, and the delta
 * compares like-for-like amounts. (A whole-day "clock-aligned" shift would
 * leave a gap whenever the current window ends mid-day, e.g. "hoy hasta ahora".)
 */
export function previousRange(range: DateRange): DateRange {
  const span = range.end.getTime() - range.start.getTime()
  return { start: new Date(range.start.getTime() - span), end: range.start }
}

/** Bucket granularity for a range: hourly for short spans (≤ ~2 days) so
 *  "Hoy"/"Ayer" render a useful curve; daily for longer ranges. */
export function bucketGranularity(range: DateRange): 'hour' | 'day' {
  // Ranges up to 2 days (Hoy, Ayer, a 1–2 day custom range) bucket hourly so
  // the curve is meaningful; 3+ days bucket daily.
  const span = range.end.getTime() - range.start.getTime()
  return span <= 2 * 24 * 60 * 60 * 1000 ? 'hour' : 'day'
}

/** Hour-of-day key (YYYY-MM-DDTHH) of `instant` as seen in `tz`. */
export function hourKey(tz: string, d: Date | string): string {
  const instant = typeof d === 'string' ? new Date(d) : d
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}`
}

/** Bucket key of `instant` at the given granularity (hour or day), in `tz`. */
export function bucketKeyOf(tz: string, d: Date | string, gran: 'hour' | 'day'): string {
  return gran === 'hour' ? hourKey(tz, d) : dayKey(tz, d)
}

/**
 * Ordered list of bucket keys spanning `range` at `gran`, so a chart can
 * seed every bucket (empty ones render as 0) and stay chronological.
 */
export function rangeBucketKeys(tz: string, range: DateRange, gran: 'hour' | 'day'): string[] {
  if (gran === 'day') {
    const startYmd = ymdInTz(tz, range.start)
    // end is exclusive — the last day with data is end - 1ms.
    const endYmd = ymdInTz(tz, new Date(Math.max(range.start.getTime(), range.end.getTime() - 1)))
    const keys: string[] = []
    let cur = startYmd
    let guard = 0
    while (guard++ < 5000) {
      keys.push(cur)
      if (cur === endYmd) break
      cur = shiftYmd(cur, 1)
    }
    return keys
  }
  // hour: step one hour at a time, dedupe (covers partial first/last hours).
  const keys: string[] = []
  const seen = new Set<string>()
  const endMs = range.end.getTime()
  let t = range.start.getTime()
  let guard = 0
  while (t < endMs && guard++ < 100_000) {
    const k = hourKey(tz, new Date(t))
    if (!seen.has(k)) {
      seen.add(k)
      keys.push(k)
    }
    t += 60 * 60 * 1000
  }
  // Guarantee the bucket containing the final instant is present.
  if (endMs > range.start.getTime()) {
    const lastK = hourKey(tz, new Date(endMs - 1))
    if (!seen.has(lastK)) keys.push(lastK)
  }
  return keys
}
