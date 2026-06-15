"use client";

import { useCallback } from "react";
import { useCsrfRefresh, useCsrfToken } from "@/components/auth/csrf-provider";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "csrf") return rest.join("=") || null;
  }
  return null;
}

export type FetchWithCsrf = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Client-side fetch wrapper that injects the double-submit CSRF token
 * for state-changing methods. Reads the token first from React context
 * (kept in sync by CsrfProvider), then falls back to the cookie set by
 * /api/csrf — that fallback lets the wrapper work on the very first
 * render before the provider's effect has run.
 *
 * Always passes credentials: "same-origin" so the csrf cookie is sent
 * alongside the header — the server check requires both.
 */
export function useFetchWithCsrf(): FetchWithCsrf {
  const token = useCsrfToken();
  const refresh = useCsrfRefresh();

  return useCallback<FetchWithCsrf>(
    async (input, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const needsCsrf = MUTATING.has(method);

      const headers = new Headers(init.headers);
      if (needsCsrf) {
        const value = token ?? readCsrfCookie();
        if (value) headers.set("x-csrf-token", value);
      }

      const res = await fetch(input, {
        ...init,
        headers,
        credentials: init.credentials ?? "same-origin",
      });

      // If the server rejected for csrf, refresh the token and retry once.
      if (res.status === 403 && needsCsrf) {
        const body = await res
          .clone()
          .json()
          .catch(() => null);
        if (body && (body as { error?: string }).error === "csrf_mismatch") {
          await refresh();
          const retryHeaders = new Headers(init.headers);
          const value = readCsrfCookie();
          if (value) retryHeaders.set("x-csrf-token", value);
          return fetch(input, {
            ...init,
            headers: retryHeaders,
            credentials: init.credentials ?? "same-origin",
          });
        }
      }
      return res;
    },
    [token, refresh],
  );
}
