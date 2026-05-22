"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Workspace, WorkspaceMember } from "@/types";

interface WorkspaceState {
  workspace: Workspace | null;
  membership: WorkspaceMember | null;
  isAdmin: boolean;
  loading: boolean;
  reload: () => void;
}

/**
 * Returns the user's current workspace + role. Picks the first
 * membership (we don't have a workspace switcher yet; if/when a user
 * belongs to multiple workspaces we'll persist their selection in
 * localStorage and add a picker in the header).
 */
export function useWorkspace(): WorkspaceState {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [membership, setMembership] = useState<WorkspaceMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setWorkspace(null);
          setMembership(null);
          setLoading(false);
        }
        return;
      }

      const { data: memberships } = await supabase
        .from("workspace_members")
        .select("*, workspace:workspaces(*)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: true })
        .limit(1);

      if (cancelled) return;
      const m = (memberships ?? [])[0] as
        | (WorkspaceMember & { workspace?: Workspace })
        | undefined;
      setMembership(m ?? null);
      setWorkspace(m?.workspace ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadCounter]);

  return {
    workspace,
    membership,
    isAdmin: membership?.role === "admin",
    loading,
    reload: () => setReloadCounter((n) => n + 1),
  };
}
