"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Channel } from "@/types";

interface ActiveConnectionsState {
  /** Set of channels that have at least one connection with status='connected'. */
  channels: Set<Channel>;
  /** Human label per connected channel (the merchant's label, falling back to
   *  the external account id — e.g. the WhatsApp number / phone_number_id).
   *  Lets callers tell the user *which* account an action runs through. */
  labels: Map<Channel, string>;
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
  const [labels, setLabels] = useState<Map<Channel, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("channel_connections")
        .select("channel, label, external_account_id")
        .eq("status", "connected");
      if (cancelled) return;
      const set = new Set<Channel>();
      const labelMap = new Map<Channel, string>();
      for (const row of (data ?? []) as Array<{
        channel: Channel;
        label: string | null;
        external_account_id: string | null;
      }>) {
        set.add(row.channel);
        if (!labelMap.has(row.channel)) {
          const lbl = row.label ?? row.external_account_id ?? null;
          if (lbl) labelMap.set(row.channel, lbl);
        }
      }
      setChannels(set);
      setLabels(labelMap);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return {
    channels,
    labels,
    hasAny: channels.size > 0,
    loading,
    reload: () => setTick((n) => n + 1),
  };
}
