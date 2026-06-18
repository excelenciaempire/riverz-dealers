"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

/**
 * The single "app timezone": the WORKSPACE's configured IANA zone. It drives
 * every timestamp the inbox shows AND every metric day-boundary on the
 * dashboard, so the whole team sees one consistent clock no matter where
 * each member physically connects from.
 *
 * Reads `workspaces.timezone` (via the caller's membership) on mount, falls
 * back to the browser's resolved zone, then to America/Bogota. The value
 * mirrors to localStorage so navigations don't flash the wrong tz while the
 * supabase query is in flight.
 *
 * Returns the IANA string so callers can pass it to
 * `formatInTimeZone(date, tz, 'HH:mm')` from date-fns-tz, or to the
 * dashboard date helpers.
 *
 * Admins change it from Ajustes → Espacio de trabajo; that screen calls
 * {@link cacheWorkspaceTimezone} on save so the new zone is picked up without
 * a stale flash on the next navigation.
 */

const LS_KEY = "ui.workspace.timezone";

function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function initialTz(): string {
  if (typeof window === "undefined") return DEFAULT_TIMEZONE;
  try {
    const cached = window.localStorage.getItem(LS_KEY);
    if (cached) return cached;
  } catch {
    // localStorage disabled (private mode) — fall through.
  }
  return browserTz();
}

/** Persist the workspace tz so the next mount reads it without a flash. */
export function cacheWorkspaceTimezone(tz: string): void {
  try {
    window.localStorage.setItem(LS_KEY, tz);
  } catch {
    // no-op
  }
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
      // Resolve the caller's workspace the same way useWorkspace does: first
      // live (non-deleted) membership by joined_at. We only need its tz.
      const { data } = await supabase
        .from("workspace_members")
        .select("joined_at, workspace:workspaces(timezone, deleted_at)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: true });
      if (cancelled || !data) return;
      const live = (
        data as Array<{
          workspace?: { timezone?: string; deleted_at?: string | null } | null;
        }>
      )
        .map((m) => m.workspace)
        .find((w) => w && !w.deleted_at);
      const fromDb = live?.timezone;
      if (fromDb && fromDb !== tz) {
        setTz(fromDb);
        cacheWorkspaceTimezone(fromDb);
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
