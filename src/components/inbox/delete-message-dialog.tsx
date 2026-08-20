"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-locale";
import type { Channel } from "@/types";

/** A quién le desaparece el mensaje. */
export type DeleteScope = "me" | "everyone";

/**
 * ¿Este canal deja borrar el mensaje del lado del cliente?
 *
 * Sólo los comentarios. Un comentario vive en el post de la marca y la API de
 * la red deja borrarlo de verdad (es lo mismo que hace el botón de la barra de
 * moderación). Un mensaje directo no: ni WhatsApp, ni Instagram, ni Messenger,
 * ni Mercado Libre, ni el correo exponen un "deshacer envío" para terceros.
 * Prometerlo con un botón que después no borra nada sería peor que no tenerlo.
 */
export function canDeleteForEveryone(channel: Channel): boolean {
  return (
    channel === "fb_comment" ||
    channel === "ig_comment" ||
    channel === "tiktok_comment"
  );
}

/**
 * Confirmación de borrado, de Riverz y no del navegador.
 *
 * Donde se puede, ofrece las dos opciones y hace la que se elija. Donde no,
 * lo dice en una línea en vez de dejar al comercio creyendo que el cliente
 * dejó de ver el mensaje.
 */
export function DeleteMessageDialog({
  open,
  onOpenChange,
  channel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: Channel;
  onConfirm: (scope: DeleteScope) => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState<DeleteScope | null>(null);
  const both = canDeleteForEveryone(channel);

  const run = async (scope: DeleteScope) => {
    if (busy) return;
    setBusy(scope);
    try {
      await onConfirm(scope);
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Trash2 className="h-4 w-4" />
            {t("inbox.deleteMessageTitle")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {both
              ? t("inbox.deleteMessageBothDesc")
              : t("inbox.deleteMessageOnlyMineDesc", {
                  channel: t(`inbox.channel_${channel}`),
                })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {both && (
            <Button
              variant="destructive"
              className="justify-center"
              disabled={busy !== null}
              onClick={() => run("everyone")}
            >
              {busy === "everyone" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("inbox.deleteForEveryone")}
            </Button>
          )}
          <Button
            variant={both ? "outline" : "destructive"}
            className="justify-center"
            disabled={busy !== null}
            onClick={() => run("me")}
          >
            {busy === "me" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("inbox.deleteForMe")}
          </Button>
          <Button
            variant="ghost"
            className="justify-center text-muted-foreground"
            disabled={busy !== null}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
