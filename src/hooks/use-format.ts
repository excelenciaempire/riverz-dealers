"use client";

import { useMemo } from "react";
import { useLocale } from "./use-locale";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
} from "@/lib/i18n/format";

/**
 * Locale-aware display formatters bound to the active UI locale. Use in
 * client components for any date/number SHOWN TO THE MERCHANT:
 *
 *   const fmt = useFormat();
 *   fmt.date(row.created_at)                 // "June 20, 2026" / "20 de junio de 2026"
 *   fmt.dateTime(msg.sent_at)
 *   fmt.number(count)
 *   fmt.currency(total, "USD")
 */
export function useFormat() {
  const { locale } = useLocale();
  return useMemo(
    () => ({
      date: (v: Date | string | number, opts?: Intl.DateTimeFormatOptions) =>
        formatDate(v, locale, opts),
      dateTime: (v: Date | string | number, opts?: Intl.DateTimeFormatOptions) =>
        formatDateTime(v, locale, opts),
      time: (v: Date | string | number, opts?: Intl.DateTimeFormatOptions) =>
        formatTime(v, locale, opts),
      number: (v: number, opts?: Intl.NumberFormatOptions) => formatNumber(v, locale, opts),
      currency: (v: number, currency?: string, opts?: Intl.NumberFormatOptions) =>
        formatCurrency(v, locale, currency, opts),
    }),
    [locale],
  );
}
