"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Send, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useT } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";

interface PendingDraft {
  id: string;
  text: string;
  agent_name: string | null;
  created_at: string;
}

/**
 * La respuesta que el asistente dejó lista y todavía no salió.
 *
 * Aparece sobre el compositor cuando el agente está en modo "aprobar cada
 * mensaje" (migración 170). El texto se puede corregir ahí mismo antes de
 * enviarlo — corregir dos palabras no debería obligar a copiar y pegar.
 *
 * Enviar reutiliza el mismo camino que escribir a mano (`onSend`), así que
 * el mensaje sale como lo que es: algo que una persona aprobó.
 */
export function PendingReplyCard({
  conversationId,
  onSend,
}: {
  conversationId: string;
  onSend: (text: string) => void | Promise<void>;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [draft, setDraft] = useState<PendingDraft | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Carga inicial + refresco al cambiar de conversación.
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    setDraft(null);
    (async () => {
      const res = await fetch(
        `/api/conversations/${conversationId}/pending-reply`,
      ).catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = (await res.json().catch(() => null)) as {
        draft?: PendingDraft | null;
      } | null;
      if (cancelled) return;
      setDraft(data?.draft ?? null);
      setText(data?.draft?.text ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // En vivo: la propuesta la escribe el runner en el servidor, así que sin
  // esto habría que recargar para verla — justo lo contrario de contestar rápido.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`pending-reply:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ai_pending_replies",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setDraft(null);
            setText("");
            return;
          }
          const row = payload.new as {
            id: string;
            content_text: string;
            agent_name: string | null;
            created_at: string;
          };
          const next: PendingDraft = {
            id: row.id,
            text: row.content_text,
            agent_name: row.agent_name,
            created_at: row.created_at,
          };
          setDraft(next);
          setText(row.content_text);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Alto según el contenido, hasta 8 líneas.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    // Misma regla que el compositor: la barra sólo cuando la caja ya no puede
    // crecer. Windows dibuja flechas de scroll y quedan al lado de una linea.
    el.style.overflowY = el.scrollHeight > 180 ? "auto" : "hidden";
  }, [text, draft]);

  const discard = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setDraft(null);
    await fetchWithCsrf(`/api/conversations/${conversationId}/pending-reply`, {
      method: "DELETE",
    }).catch(() => null);
    setBusy(false);
  }, [busy, conversationId, fetchWithCsrf]);

  const approve = useCallback(async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onSend(body);
      setDraft(null);
      setText("");
      await fetchWithCsrf(`/api/conversations/${conversationId}/pending-reply`, {
        method: "DELETE",
      }).catch(() => null);
    } catch {
      toast.error(t("inbox.pendingReplyFailed"));
    } finally {
      setBusy(false);
    }
  }, [text, busy, onSend, fetchWithCsrf, conversationId, t]);

  if (!draft) return null;

  return (
    <div className="border-t border-border bg-primary/5 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="size-3.5 shrink-0 text-primary" />
        <span className="text-xs font-medium text-foreground">
          {draft.agent_name
            ? t("inbox.pendingReplyFrom", { name: draft.agent_name })
            : t("inbox.pendingReplyTitle")}
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={1}
        className="scrollbar-thin w-full resize-none overflow-y-hidden rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground hover:text-foreground"
          onClick={discard}
          disabled={busy}
        >
          <X className="mr-1 size-3.5" />
          {t("inbox.pendingReplyDiscard")}
        </Button>
        <Button
          size="sm"
          className="h-8 bg-primary hover:bg-primary/90"
          onClick={approve}
          disabled={busy || !text.trim()}
        >
          {busy ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" />
          ) : (
            <Send className="mr-1 size-3.5" />
          )}
          {t("inbox.pendingReplySend")}
        </Button>
      </div>
    </div>
  );
}
