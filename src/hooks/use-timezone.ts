"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Per-user IANA timezone, used to format every date the inbox shows.
 *
 * Reads from `profiles.timezone` on mount, falls back to the browser's
 * resolved timezone, then to "America/Bogota". The value also mirrors
 * to localStorage so subsequent navigations don't flash the wrong tz
 * while the supabase query is in flight.
 *
 * Returns the IANA string so callers can pass it to
 * `formatInTimeZone(date, tz, 'HH:mm')` from date-fns-tz.
 */

const LS_KEY = "ui.user.timezone";

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Bogota";
  } catch {
    return "America/Bogota";
  }
}

function initialTz(): string {
  if (typeof window === "undefined") return "America/Bogota";
  try {
    const cached = window.localStorage.getItem(LS_KEY);
    if (cached) return cached;
  } catch {
    // localStorage disabled (private mode) — fall through.
  }
  return browserTz();
}

export function useTimezone(): string {
  const [tz, setTz] = useState<string>(initialTz);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const fromDb = (data as { timezone?: string } | null)?.timezone;
      if (fromDb && fromDb !== tz) {
        setTz(fromDb);
        try {
          window.localStorage.setItem(LS_KEY, fromDb);
        } catch {
          // no-op
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // tz intentionally out of deps: it's the *current* value we want to
    // overwrite, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return tz;
}
