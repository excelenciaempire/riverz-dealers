import {
  dayKey,
  daysAgoStart,
  rangeForPreset,
} from '@/lib/dashboard/date-utils';
import { fromZonedTime } from 'date-fns-tz';
import type { Rango } from './movimientos';

export function walletDateRange(
  tz: string,
  days: number | null,
  from: string,
  to: string
): Rango {
  if (days === null) {
    const defaults = walletDefaultDates(tz);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !Number.isFinite(Date.parse(from)))
      from = defaults.from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(Date.parse(to)))
      to = defaults.to;
    const [first, last] = [from, to].sort();
    const next = new Date(`${last}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return {
      desde: fromZonedTime(`${first}T00:00:00`, tz).toISOString(),
      hasta: fromZonedTime(
        `${next.toISOString().slice(0, 10)}T00:00:00`,
        tz
      ).toISOString(),
    };
  }
  if (days === 90)
    return {
      desde: daysAgoStart(tz, 89).toISOString(),
      hasta: new Date().toISOString(),
    };
  const range = rangeForPreset(
    tz,
    days === 0 ? 'today' : days === -1 ? 'yesterday' : days === 7 ? '7d' : '30d'
  );
  return { desde: range.start.toISOString(), hasta: range.end.toISOString() };
}
export function walletDefaultDates(tz: string) {
  return { from: dayKey(tz, daysAgoStart(tz, 29)), to: dayKey(tz, new Date()) };
}
