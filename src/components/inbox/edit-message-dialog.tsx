"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-locale";
import { MAX_EDIT_LENGTH } from "@/lib/inbox/editable";
import type { Channel } from "@/types";

/**
 * Reescribir un mensaje que ya salió. Sólo aparece en los canales donde la
 * edición llega al cliente (chat web y comentario de Facebook); en el resto
 * el botón ni se dibuja, así que acá no hace falta explicar nada: alcanza con
 * decir dónde se va a ver el cambio.
 */
export function EditMessageDialog({
  open,
  onOpenChange,
  channel,
  initialText,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: Channel;
  initialText: string;
  onConfirm: (text: string) => Promise<void>;
}) {
  const t = useT();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);

  // Reabrir sobre otro mensaje (o después de cancelar) tiene que mostrar el
  // texto real, no el borrador de la vez anterior.
  useEffect(() => {
    if (open) setText(initialText);
  }, [open, initialText]);

  const limpio = text.trim();
  const sinCambios = limpio === initialText.trim();

  const run = async () => {
    if (busy || !limpio || sinCambios) return;
    setBusy(true);
    try {
      await onConfirm(limpio);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Pencil className="h-4 w-4" />
            {t("inbox.editMessageTitle")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {channel === "fb_comment"
              ? t("inbox.editMessageCommentDesc")
              : t("inbox.editMessageChatDesc")}
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_EDIT_LENGTH))}
          rows={5}
          autoFocus
          disabled={busy}
          className="w-full resize-none rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
        />

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            className="text-muted-foreground"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button disabled={busy || !limpio || sinCambios} onClick={run}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
