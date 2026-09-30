"use client";

import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { useState, type ReactNode } from "react";
import { CornerUpLeft, Copy, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Message } from "@/types";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useT } from "@/hooks/use-locale";
import {
  DeleteMessageDialog,
  deleteForEveryoneNeedsNetwork,
  type DeleteScope,
} from "./delete-message-dialog";
import { EditMessageDialog } from "./edit-message-dialog";
import { puedeEditarse } from "@/lib/inbox/editable";
import { MessageEvidence } from './message-evidence';

// WhatsApp's own quick-reaction bar starts with these six. Picking the same
// set keeps the affordance familiar without pulling in a 300KB emoji library.
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  /** Optional — wires the trash button. If omitted, the button is
   *  hidden so callers that don't yet wire delete (e.g. preview
   *  surfaces) aren't forced to. */
  onDelete?: (messageId: string) => void;
  /** Identificador en el DOM, para poder llevar el scroll hasta este
   *  mensaje. Lo usa el ancla: entrar al hilo directo en el mensaje de una
   *  fecha en vez de al final. */
  anclaId?: string;
  /** Pinta el mensaje al que se llegó por el ancla, para que se vea cuál
   *  es entre todos los de alrededor. */
  resaltado?: boolean;
  children: ReactNode;
}

/**
 * Hover/long-press toolbar wrapper around a `<MessageBubble>`. The bubble
 * itself stays a pure presenter — this component owns the action surface so
 * the bubble's render path is unaffected when the toolbar isn't visible.
 */
export function MessageActions({
  message,
  onReply,
  onReact,
  onDelete,
  anclaId,
  resaltado,
  children,
}: MessageActionsProps) {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  // Touch devices have no hover. Long-press fires `contextmenu`; we capture
  // it, suppress the native menu, and pin the toolbar open until the user
  // interacts elsewhere.
  const [touchOpen, setTouchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const isAgent =
    message.sender_type === "agent" || message.sender_type === "bot";
  // Emails render as full-width cards (often a 600px marketing layout), not
  // chat bubbles — the 75% cap squeezes them so headings wrap mid-word.
  const isEmail = message.channel === "gmail" || message.channel === "outlook" || message.channel === "zoho";
  // Reaccionar y responder-a-un-mensaje son propios de los chats de mensajería.
  // En Mercado Libre (preguntas/mensajes), email y comentarios no existen esas
  // acciones — se contesta desde el composer / la barra de moderación. Copiar
  // sí aplica a todos.
  const canQuickAct = ["whatsapp", "instagram", "messenger"].includes(
    message.channel,
  );
  // En un comentario el tacho de acá NO va: la barra de moderación ya tiene el
  // suyo, y hacen cosas distintas —éste borra la fila de la bandeja, aquél
  // borra el comentario en Instagram/Facebook— detrás del mismo ícono y a dos
  // centímetros de distancia. Dos tachos iguales, uno local y otro público e
  // irreversible, es una trampa. Queda el de la barra, que es el que el
  // comercio quiere el 99% de las veces; copiar sigue disponible.
  const isComment =
    message.channel === "fb_comment" ||
    message.channel === "ig_comment" ||
    message.channel === "tiktok_comment";
  const canDelete = Boolean(onDelete) && !isComment;
  // Editar lo ya enviado: sólo donde el canal deja que el cambio le llegue
  // al cliente (chat web y comentario de Facebook). Ver lib/inbox/editable.
  const canEdit = puedeEditarse(message);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setTouchOpen(true);
  };

  const handleCopy = async () => {
    const text = message.content_text ?? "";
    if (!text) {
      toast.error(t("inbox.nothingToCopy"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("inbox.copied"));
    } catch {
      toast.error(t("inbox.copyFailed"));
    }
    setTouchOpen(false);
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
    setTouchOpen(false);
  };

  const handleReply = () => {
    onReply();
    setTouchOpen(false);
  };

  /** Guarda el texto nuevo; el canal se encarga adentro del endpoint. */
  const runEdit = async (text: string) => {
    try {
      const res = await fetchWithCsrf(`/api/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? t("inbox.editMessageFailed"));
        return;
      }
      toast.success(t("inbox.messageEdited"));
    } catch {
      toast.error(t("inbox.networkError"));
    }
  };

  const handleDelete = () => {
    if (!onDelete) return;
    setTouchOpen(false);
    setDeleteOpen(true);
  };

  /**
   * Borra segun lo elegido. "Para todos" primero borra en la red y solo si eso
   * sale bien saca la fila: al reves, un fallo de la API dejaria el mensaje
   * vivo en la red y desaparecido de la bandeja, que es la peor combinacion.
   */
  const runDelete = async (scope: DeleteScope) => {
    if (!onDelete) return;
    try {
      // En el chat web no hay red a la que pedirle nada: el borrado suave de
      // abajo ya lo saca de la pantalla del visitante.
      if (scope === "everyone" && deleteForEveryoneNeedsNetwork(message.channel)) {
        const res = await fetchWithCsrf("/api/messages/moderate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: message.id, action: "delete" }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(j.error ?? t("inbox.deleteMessageFailed"));
          return;
        }
      }
      const res = await fetchWithCsrf(`/api/messages/${message.id}?scope=${scope}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? t("inbox.deleteMessageFailed"));
        return;
      }
      onDelete(message.id);
      toast.success(t("inbox.messageDeleted"));
    } catch {
      toast.error(t("inbox.networkError"));
    }
  };

  // Row alignment lives here (not in MessageBubble) so the `group/actions`
  // hover region matches the bubble's content width — hovering empty space
  // in the row no longer reveals the toolbar.
  return (
    <div
      id={anclaId}
      className={cn(
        "flex w-full",
        isAgent ? "justify-end" : "justify-start",
        // El resaltado se desvanece solo (la clase se saca a los pocos
        // segundos): sirve para encontrar el mensaje, no para quedarse.
        resaltado &&
          "-mx-2 rounded-xl bg-amber-500/10 px-2 py-1 ring-2 ring-amber-400/60",
        "transition-colors duration-700",
      )}
      onContextMenu={handleContextMenu}
      onBlur={() => setTouchOpen(false)}
    >
      <div
        className={cn(
          "group/actions relative",
          // Emails get the full row and do their own left/right alignment +
          // width inside (a wide HTML column vs a shrink-to-fit text bubble).
          isEmail ? "w-full" : "max-w-[75%]",
        )}
      >
        {children}
      <div
        data-touch-open={touchOpen || pickerOpen ? "true" : undefined}
        className={cn(
          "absolute -top-3 z-10 flex h-9 md:h-7 items-center gap-0.5 rounded-full border border-border bg-card/95 px-1 shadow-md backdrop-blur-sm transition-opacity",
          "opacity-0 group-hover/actions:opacity-100 group-focus-within/actions:opacity-100",
          "data-[touch-open=true]:opacity-100",
          isAgent ? "right-3" : "left-3",
        )}
      >
        {SHOW_RIVERZ_IMPROVEMENTS && (message.sender_type==='bot' || message.sender_type==='customer') && <MessageEvidence conversationId={message.conversation_id} messageId={message.id} />}
        {canQuickAct && (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              className="flex h-8 w-8 md:h-5 md:w-5 items-center justify-center rounded-full text-foreground hover:bg-accent hover:text-foreground"
              aria-label={t("inbox.react")}
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </PopoverTrigger>
            <PopoverContent
              className="flex w-auto flex-row gap-1 p-1.5"
              sideOffset={6}
            >
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => handlePickEmoji(e)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125 hover:bg-accent"
                  aria-label={t("inbox.reactWith", { emoji: e })}
                >
                  {e}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
        {canQuickAct && (
          <button
            type="button"
            onClick={handleReply}
            className="flex h-8 w-8 md:h-5 md:w-5 items-center justify-center rounded-full text-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("inbox.reply")}
          >
            <CornerUpLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="flex h-8 w-8 md:h-5 md:w-5 items-center justify-center rounded-full text-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("inbox.copy")}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setTouchOpen(false);
              setEditOpen(true);
            }}
            className="flex h-8 w-8 md:h-5 md:w-5 items-center justify-center rounded-full text-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("inbox.editMessage")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={handleDelete}
            className="flex h-8 w-8 md:h-5 md:w-5 items-center justify-center rounded-full text-foreground hover:bg-red-500/20 hover:text-red-700 dark:hover:text-red-400"
            aria-label={t("inbox.delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      </div>
      <EditMessageDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        channel={message.channel}
        initialText={message.content_text ?? ""}
        onConfirm={runEdit}
      />
      <DeleteMessageDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        channel={message.channel}
        onConfirm={runDelete}
      />
    </div>
  );
}
