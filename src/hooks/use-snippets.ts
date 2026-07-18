"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "./use-workspace";
import type { MessageSnippet } from "@/types";

/**
 * Workspace "/" snippets (canned replies, migration 096). RLS scopes reads to
 * the active workspace. Fail-soft: if the table is missing (migration not
 * applied) or the select errors, `snippets` stays empty and the composer keeps
 * its built-in defaults — the picker never breaks.
 */
export function useSnippets() {
  const { workspace } = useWorkspace();
  const [snippets, setSnippets] = useState<MessageSnippet[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("message_snippets")
      .select("*")
      .order("shortcut", { ascending: true });
    setSnippets(error ? [] : ((data ?? []) as MessageSnippet[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (shortcut: string, body: string, title?: string): Promise<{ error?: string }> => {
      if (!workspace?.id) return { error: "no-workspace" };
      const clean = shortcut.trim().replace(/^\/+/, "").toLowerCase();
      if (!clean || !body.trim()) return { error: "empty" };
      const supabase = createClient();
      const { error } = await supabase.from("message_snippets").insert({
        workspace_id: workspace.id,
        shortcut: clean,
        title: title?.trim() || null,
        body: body.trim(),
      });
      if (!error) await reload();
      return { error: error?.message };
    },
    [workspace?.id, reload],
  );

  const remove = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const supabase = createClient();
      const { error } = await supabase.from("message_snippets").delete().eq("id", id);
      if (!error) await reload();
      return { error: error?.message };
    },
    [reload],
  );

  return { snippets, loading, reload, create, remove };
}
