"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "./use-workspace";
import { useDeferredLoad } from './use-deferred-load';
import type { MessageSnippet } from "@/types";

/**
 * Workspace "/" snippets (canned replies, migration 096). RLS scopes reads to
 * the active workspace. Fail-soft: if the table is missing (migration not
 * applied) or the select errors, `snippets` stays empty and the composer keeps
 * its built-in defaults — the picker never breaks.
 */
export function useSnippets() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;
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

  useDeferredLoad(reload);

  const create = useCallback(
    async (shortcut: string, body: string, title?: string): Promise<{ error?: string }> => {
      if (!workspaceId) return { error: "no-workspace" };
      const clean = shortcut.trim().replace(/^\/+/, "").toLowerCase();
      if (!clean || !body.trim()) return { error: "empty" };
      const supabase = createClient();
      // El shortcut es único por workspace: si ya hay fila (incluida una
      // lápida de un atajo eliminado) se reescribe, no se inserta.
      const previa = snippets.find((s) => s.shortcut.toLowerCase() === clean);
      const { error } = previa
        ? await supabase
            .from("message_snippets")
            .update({ title: title?.trim() || null, body: body.trim(), hidden: false })
            .eq("id", previa.id)
        : await supabase.from("message_snippets").insert({
            workspace_id: workspaceId,
            shortcut: clean,
            title: title?.trim() || null,
            body: body.trim(),
          });
      if (!error) await reload();
      return { error: error?.message };
    },
    [workspaceId, reload, snippets],
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

  /**
   * Eliminar un atajo base (los que vienen en el código del composer) no
   * borra nada: deja una lápida `hidden` con ese shortcut para que el picker
   * lo tape. Si ya había una fila con ese shortcut, se marca esa.
   */
  const hide = useCallback(
    async (shortcut: string, existingId?: string): Promise<{ error?: string }> => {
      if (!workspaceId) return { error: "no-workspace" };
      const clean = shortcut.trim().replace(/^\/+/, "").toLowerCase();
      if (!clean) return { error: "empty" };
      const supabase = createClient();
      const { error } = existingId
        ? await supabase
            .from("message_snippets")
            .update({ hidden: true })
            .eq("id", existingId)
        : await supabase.from("message_snippets").insert({
            workspace_id: workspaceId,
            shortcut: clean,
            body: "",
            hidden: true,
          });
      if (!error) await reload();
      return { error: error?.message };
    },
    [workspaceId, reload],
  );

  return { snippets, loading, reload, create, remove, hide };
}
