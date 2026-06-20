import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { translate, type TFn } from "./translate";

/**
 * Server-side locale read for the root layout, metadata and the handful of
 * server components. The cookie is the single source of truth: the proxy
 * seeds it (IP/Accept-Language default) on first visit, and the client
 * LocaleProvider keeps it in sync after that.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** A server-side `t()` bound to the request's locale. */
export async function getT(): Promise<TFn> {
  const locale = await getLocale();
  return (key, vars) => translate(locale, key, vars);
}
