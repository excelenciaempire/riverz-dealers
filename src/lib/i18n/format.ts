import { es, enUS, type Locale as DateFnsLocale } from "date-fns/locale";
import type { Locale } from "./config";

/**
 * date-fns Locale object for the active UI locale — for the few places
 * that format dates with date-fns / date-fns-tz (timezone-aware inbox
 * timestamps) instead of Intl. Keeps month/weekday names in the user's
 * language. Use the Intl helpers in this file for everything else.
 */
export function dateFnsLocale(locale: Locale): DateFnsLocale {
  return locale === "en" ? enUS : es;
}

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

/**
 * Plata sin centavos: 1.499.730 ARS, no 1.499.730,00 ARS.
 *
 * Para un precio los centavos son el precio; para una métrica son dos dígitos
 * que siempre dicen "00" y que le roban peso a la cifra que importa. Se usa
 * en totales y agregados (paneles, atribución, reportes) — nunca en el precio
 * de un producto ni en el total de un pedido concreto que el cliente paga.
 */
export function formatMoney(
  value: number,
  locale: Locale,
  currency = "USD",
): string {
  return formatCurrency(value, locale, currency, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
