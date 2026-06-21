import type { Locale } from "./config";

/**
 * Locale-aware display formatting for dates, times and numbers. Pure
 * functions that take the locale explicitly, so they work in both client
 * components (via the useFormat() hook) and server components (pass
 * getLocale()). Use these for anything SHOWN TO THE MERCHANT — never
 * hardcode 'es-ES'. (Internal date math / bucket keys stay on 'en-CA' etc.
 * and must NOT use these.)
 */

/** BCP-47 tag for Intl APIs. */
export function localeTag(locale: Locale): string {
  return locale === "en" ? "en-US" : "es-ES";
}

function toDate(value: Date | string | number): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DEFAULT_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};

const DEFAULT_DATETIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

export function formatDate(
  value: Date | string | number,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = DEFAULT_DATE,
): string {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(localeTag(locale), opts).format(d) : "";
}

export function formatDateTime(
  value: Date | string | number,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = DEFAULT_DATETIME,
): string {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(localeTag(locale), opts).format(d) : "";
}

export function formatTime(
  value: Date | string | number,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat(localeTag(locale), opts).format(d) : "";
}

export function formatNumber(
  value: number,
  locale: Locale,
  opts?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(localeTag(locale), opts).format(value);
}

export function formatCurrency(
  value: number,
  locale: Locale,
  currency = "USD",
  opts?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(localeTag(locale), {
    style: "currency",
    currency,
    ...opts,
  }).format(value);
}
