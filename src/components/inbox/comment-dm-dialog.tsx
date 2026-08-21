"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useLocalizedRouter } from "@/hooks/use-localized-router";
import { useT } from "@/hooks/use-locale";

/**
 * Escribirle al privado a quien comentó, desde la propia burbuja.
 *
 * Muestra el comentario arriba para no escribir a ciegas y manda el mensaje
 * como respuesta privada a ESE comentario (la única vía que Meta permite para
 * alguien que sólo comentó). El mensaje queda en la bandeja: en el hilo privado
 * y reflejado bajo el comentario, así que después se sigue desde ahí.
 */
export function CommentDmDialog({
  open,
  onOpenChange,
  messageId,
  commentText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  commentText: string;
}) {
  const t = useT();
  const router = useLocalizedRouter();
  const fetchWithCsrf = useFetchWithCsrf();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetchWithCsrf("/api/comments/dm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message_id: messageId, text: text.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        conversation_id?: string | null;
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? t("inbox.commentDmFailed"));
        return;
      }
      onOpenChange(false);
      setText("");
      toast.success(
        t("inbox.commentDmSent"),
        json.conversation_id
          ? {
              action: {
                label: t("inbox.commentDmOpen"),
                onClick: () => router.push(`/bandeja?c=${json.conversation_id}`),
              },
            }
          : undefined,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogTitle className="border-b border-border px-5 py-4">
          {t("inbox.commentDmTitle")}
        </DialogTitle>
        <div className="space-y-3 p-5">
          {commentText.trim() && (
            <p className="rounded-lg rounded-tl-sm bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {commentText.trim().slice(0, 280)}
            </p>
          )}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("inbox.commentDmPlaceholder")}
            rows={4}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("inbox.cancel")}
          </Button>
          <Button size="sm" onClick={send} disabled={sending || !text.trim()}>
            {sending && <Loader2 className="size-3.5 animate-spin" />}
            {t("inbox.send")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
