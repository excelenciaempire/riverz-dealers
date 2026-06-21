"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "@/lib/i18n/config";
import { translate, type TFn } from "@/lib/i18n/translate";
import { canonicalizePath, localizePath } from "@/lib/i18n/routes";

/**
 * LocaleProvider — owns the active UI language for the whole app.
 *
 * Seeded server-side: the root layout reads the `riverz_locale` cookie and
 * passes it as `initialLocale`, so SSR and the first client render agree
 * (no hydration mismatch, no flash). After mount we reconcile with the
 * device-scoped localStorage mirror. Changing the language writes the
 * cookie + localStorage, persists to the user's profile (best-effort) and
 * refreshes server components so SSR'd copy re-renders.
 *
 * Mirrors ThemeProvider (src/hooks/use-theme.tsx) on purpose.
 */

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: TFn;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function writeCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // After hydration, adopt a device-scoped override if it disagrees with the
  // cookie the server used. Runs once; any change is a normal re-render
  // (post-hydration, so no mismatch warning).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(stored) && stored !== locale) {
        setLocaleState(stored);
        writeCookie(stored);
        document.documentElement.lang = stored;
      }
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        // ignore — in-memory state still updates for this tab.
      }
      writeCookie(next);
      if (typeof document !== "undefined") {
        document.documentElement.lang = next;
      }
      // Best-effort cross-device persistence for signed-in users. Anonymous
      // visitors 401 here; that's fine, the cookie already holds the choice.
      void fetch("/api/profile/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => {});
      // Switch the address bar to the new language too (e.g. /inbox ↔
      // /bandeja). Falls back to a plain refresh when the current route has no
      // localized form. router.replace re-renders server components, so we
      // don't also need router.refresh() on that path.
      try {
        const here =
          window.location.pathname +
          window.location.search +
          window.location.hash;
        const localized = localizePath(canonicalizePath(here), next);
        if (localized !== here) {
          router.replace(localized);
          return;
        }
      } catch {
        // window unavailable / malformed URL — fall through to refresh.
      }
      // Re-render server components (the few server pages + metadata) in the
      // new language. Client components already updated via state above.
      router.refresh();
    },
    [router],
  );

  // Sync across tabs — change language in tab A, tab B follows.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== LOCALE_STORAGE_KEY) return;
      if (isLocale(e.newValue) && e.newValue !== locale) {
        setLocaleState(e.newValue);
        document.documentElement.lang = e.newValue;
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [locale]);

  const t = useCallback<TFn>((key, vars) => translate(locale, key, vars), [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider — default locale,
    // no-op setter, so callers never crash.
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
    };
  }
  return ctx;
}

/** Shorthand for the common case: `const t = useT();` then `t("nav.inbox")`. */
export function useT(): TFn {
  return useLocale().t;
}
