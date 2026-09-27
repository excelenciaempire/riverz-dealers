"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Tables the dashboard aggregates over. All are published to
 * `supabase_realtime` (migrations 001 + 071) and RLS-scoped to the
 * signed-in user's workspace, so a subscriber only ever receives events
 * for its own data.
 */
const DASHBOARD_TABLES = [
  "messages",
  "conversations",
  "contacts",
  "broadcasts",
  "automation_logs",
  "orders",
] as const;

interface UseDashboardRealtimeOptions {
  /** Called (debounced) whenever any dashboard table changes. Keep it in
   *  a stable ref-free closure — the hook stores the latest reference so
   *  it never re-subscribes on parent re-render. */
  onChange: () => void;
  /** Debounce window in ms. A burst of inbound messages should trigger a
   *  single refetch, not one per row. */
  debounceMs?: number;
  enabled?: boolean;
}

/**
 * Subscribes once to every dashboard-relevant table and calls `onChange`
 * (debounced) on any INSERT/UPDATE/DELETE. The caller re-runs its data
 * loaders on each call — refetching is simpler and always correct vs.
 * incrementally patching counts that depend on local-day boundaries and
 * "vs ayer" deltas.
 *
 * Returns `isConnected` so the page can show a live indicator and force a
 * catch-up resync when the socket drops then reconnects (events emitted
 * while disconnected are lost — Supabase Realtime does not replay).
 */
export function useDashboardRealtime({
  onChange,
  debounceMs = 800,
  enabled = true,
}: UseDashboardRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false);

  // Latest callback in a ref so a re-rendered parent (new closure) doesn't
  // tear down and rebuild the channel. Assigned in an effect, not during
  // render — the channel callbacks only read `.current` asynchronously.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChangeRef.current?.();
      }, debounceMs);
    };

    let channel = supabase.channel("dashboard-realtime");
    for (const table of DASHBOARD_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        fire,
      );
    }
    channel.subscribe((status) => {
      setIsConnected(status === "SUBSCRIBED");
    });

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
      setIsConnected(false);
    };
  }, [enabled, debounceMs]);

  return { isConnected };
}
