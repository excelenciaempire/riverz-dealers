"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n/routes";

/**
 * Drop-in for next/navigation's useRouter that localizes the path passed to
 * push / replace / prefetch, so programmatic navigation keeps the URL in the
 * active language. Same API; swap `useRouter()` → `useLocalizedRouter()`.
 *
 * back / forward / refresh are passed through unchanged.
 */
export function useLocalizedRouter() {
  const router = useRouter();
  const { locale } = useLocale();
  return useMemo(
    () => ({
      ...router,
      push: (href: string, options?: Parameters<typeof router.push>[1]) =>
        router.push(localizePath(href, locale), options),
      replace: (href: string, options?: Parameters<typeof router.replace>[1]) =>
        router.replace(localizePath(href, locale), options),
      prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) =>
        router.prefetch(localizePath(href, locale), options),
    }),
    [router, locale],
  );
}
