"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Channel } from "@/types";

interface ActiveConnectionsState {
  /** Set of channels that have at least one connection with status='connected'. */
  channels: Set<Channel>;
  /** Convenience: true when at least one channel is connected. */
  hasAny: boolean;
  loading: boolean;
  reload: () => void;
}

/**
 * Lists which channels the current workspace has officially connected.
 * Used to gate Automations, Broadcasts and Flows — those modules
 * only do something useful once a real integration exists.
 */
export function useActiveConnections(): ActiveConnectionsState {
  const [channels, setChannels] = useState<Set<Channel>>(new Set());
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("channel_connections")
        .select("channel")
        .eq("status", "connected");
      if (cancelled) return;
      const set = new Set<Channel>();
      for (const row of (data ?? []) as Array<{ channel: Channel }>) {
        set.add(row.channel);
      }
      setChannels(set);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return {
    channels,
    hasAny: channels.size > 0,
    loading,
    reload: () => setTick((n) => n + 1),
  };
}
