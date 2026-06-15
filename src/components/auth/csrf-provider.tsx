"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface CsrfContextValue {
  token: string | null;
  refresh: () => Promise<void>;
}

const CsrfContext = createContext<CsrfContextValue>({
  token: null,
  refresh: async () => {},
});

export function CsrfProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await fetch("/api/csrf", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json().catch(() => null)) as
        | { token?: string }
        | null;
      if (json?.token) setToken(json.token);
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <CsrfContext.Provider value={{ token, refresh }}>
      {children}
    </CsrfContext.Provider>
  );
}

export function useCsrfToken(): string | null {
  return useContext(CsrfContext).token;
}

export function useCsrfRefresh(): () => Promise<void> {
  return useContext(CsrfContext).refresh;
}
