"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Workspace, WorkspaceMember } from "@/types";
import { selectWorkspaceMembership } from "@/lib/workspaces/select-membership";
import { selectedCommerceInBrowser } from "@/lib/auth/commerce-cookies";

interface WorkspaceState {
  workspace: Workspace | null;
  membership: WorkspaceMember | null;
  isAdmin: boolean;
  loading: boolean;
  reload: () => void;
}

/**
 * Returns the user's current workspace + role. Picks the first
 * owned workspace, then oldest membership, matching server resolution.
 * Admin store navigation selects the live membership explicitly.
 */
export function useWorkspace(): WorkspaceState {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [membership, setMembership] = useState<WorkspaceMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) {
          if (!cancelled) {
            setWorkspace(null);
            setMembership(null);
          }
          return;
        }

        const { data: memberships, error } = await supabase
          .from("workspace_members")
          .select("*, workspace:workspaces(*)")
          .eq("user_id", user.id)
          .order("joined_at", { ascending: true });
        if (error) throw error;

        if (cancelled) return;
        const m = selectWorkspaceMembership(memberships ?? [], user.id, selectedCommerceInBrowser());
        setMembership(m ?? null);
        setWorkspace(m?.workspace ?? null);
      } catch {
        // Keep known workspace data on transient failures; never leave initial loading stuck.
      } finally {
        if (!cancelled) setLoading(false);
      }
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
