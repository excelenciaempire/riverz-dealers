"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Heart, Trash2, ExternalLink, Send } from "lucide-react";
import type { Channel, Message } from "@/types";
import { useFetchWithCsrf } from "@/lib/api/fetch-with-csrf";
import { useT } from "@/hooks/use-locale";
import type { TFn } from "@/lib/i18n/translate";
import {
  DeleteMessageDialog,
  type DeleteScope,
} from "./delete-message-dialog";
import { CommentDmDialog } from "./comment-dm-dialog";

interface CommentModerationBarProps {
  message: Message;
  channel: Channel;
  permalink?: string;
  /** El comentario es NUESTRO (una respuesta del comercio o del agente).
   *  Sobre lo propio sólo se puede borrar: ni Facebook ni Instagram dejan
   *  ocultar ni likear un comentario de la misma cuenta que lo escribió. */
  own?: boolean;
  /** Se llama cuando el comentario dejó de existir en la bandeja, para que el
   *  hilo saque la burbuja sin esperar a una recarga. */
  onDeleted?: () => void;
}

/**
 * Inline moderation buttons rendered next to comment bubbles
 * (channel = 'fb_comment' | 'ig_comment'). Mirrors the actions
 * available in business.facebook.com's comment inbox.
 */
export function CommentModerationBar({
  message,
  channel,
  permalink,
  own = false,
  onDeleted,
}: CommentModerationBarProps) {
  const fetchWithCsrf = useFetchWithCsrf();
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  // Seed from the persisted flag (migration 095) so the state is correct on
  // load, and keep it in sync when a realtime UPDATE (e.g. hidden from another
  // pane) refreshes the message prop.
  const [hidden, setHidden] = useState(message.is_hidden ?? false);
  const [liked, setLiked] = useState(message.is_liked ?? false);
  useEffect(() => {
    setHidden(message.is_hidden ?? false);
  }, [message.is_hidden]);
  // El me gusta también es estado real (migración 169): TikTok lo informa en
  // cada lectura, así que si lo likearon desde la app el botón nace encendido.
  useEffect(() => {
    setLiked(message.is_liked ?? false);
  }, [message.is_liked]);

  const act = async (
    action: "hide" | "unhide" | "like" | "unlike" | "delete",
  ): Promise<boolean> => {
    setBusy(action);
    try {
      const res = await fetchWithCsrf("/api/messages/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message_id: message.id, action }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error ?? t("inbox.moderationFailed"));
        return false;
      }
      toast.success(labelFor(action, t));
      if (action === "hide") setHidden(true);
      if (action === "unhide") setHidden(false);
      if (action === "like") setLiked(true);
      if (action === "unlike") setLiked(false);
      return true;
    } finally {
      setBusy(null);
    }
  };

  /**
   * Borrar segun lo elegido. "Para todos" borra primero en la red: si eso
   * falla no se toca nada de este lado, para no dejar la bandeja diciendo que
   * un comentario que sigue publicado ya no esta.
   */
  const runDelete = async (scope: DeleteScope) => {
    if (scope === "everyone" && !(await act("delete"))) return;
    const res = await fetchWithCsrf(`/api/messages/${message.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(j.error ?? t("inbox.deleteMessageFailed"));
      return;
    }
    if (scope === "me") toast.success(t("inbox.messageDeleted"));
    onDeleted?.();
  };

  if (
    channel !== "fb_comment" &&
    channel !== "ig_comment" &&
    channel !== "tiktok_comment"
  )
    return null;
  // Sin id externo no hay nada que moderar en Meta: el botón sólo podría
  // devolver un error. (Pasa con alguna respuesta vieja que se guardó sin el
  // id que devuelve el envío.)
  if (!message.message_id) return null;

  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs">
      {/* Liking a comment only exists on Facebook. Instagram's Graph API has no
          like-comment endpoint, so the button would always fail there. */}
      {!own && channel === "fb_comment" && (
        <button
          onClick={() => act(liked ? "unlike" : "like")}
          disabled={busy !== null}
          title={liked ? t("inbox.removeLike") : t("inbox.likeAsPage")}
          aria-label={liked ? t("inbox.removeLike") : t("inbox.likeAsPage")}
          className="flex items-center gap-1 rounded-md p-2 md:px-1.5 md:py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-rose-700 dark:hover:text-rose-300"
        >
          <Heart className={liked ? "size-3 fill-rose-400 text-rose-700 dark:text-rose-400" : "size-3"} />
        </button>
      )}
      {/* Ocultar es sólo para lo ajeno —ni Facebook ni Instagram dejan
          esconder un comentario de la misma cuenta que lo escribió—, pero
          VOLVER A MOSTRAR tiene que estar siempre. Si un comentario propio
          figura oculto, alguien lo escondió desde la app nativa y sin este
          botón no había forma de revertirlo desde acá. */}
      {(!own || hidden) && (
        <button
          onClick={() => act(hidden ? "unhide" : "hide")}
          disabled={busy !== null}
          title={hidden ? t("inbox.showComment") : t("inbox.hideComment")}
          aria-label={hidden ? t("inbox.showComment") : t("inbox.hideComment")}
          className="flex items-center gap-1 rounded-md p-2 md:px-1.5 md:py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-amber-700 dark:hover:text-amber-300"
        >
          {hidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </button>
      )}
      {/* Escribirle al privado. Sólo sobre comentarios ajenos y sólo en Meta:
          TikTok no tiene mensajes directos por API. */}
      {!own && (channel === "fb_comment" || channel === "ig_comment") && (
        <button
          onClick={() => setDmOpen(true)}
          title={t("inbox.commentDmTitle")}
          aria-label={t("inbox.commentDmTitle")}
          className="flex items-center gap-1 rounded-md p-2 md:px-1.5 md:py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Send className="size-3" />
        </button>
      )}
      <button
        onClick={() => setDeleteOpen(true)}
        disabled={busy !== null}
        title={t("inbox.delete")}
        aria-label={t("inbox.deleteComment")}
        className="flex items-center gap-1 rounded-md p-2 md:px-1.5 md:py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-red-700 dark:hover:text-red-400"
      >
        <Trash2 className="size-3" />
      </button>
      {hidden && (
        <span className="ml-0.5 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
          {t("inbox.moderationHidden")}
        </span>
      )}
      {permalink && (
        <a
          href={permalink}
          target="_blank"
          rel="noopener noreferrer"
          title={t("inbox.openInFacebookInstagram")}
          className="flex items-center gap-1 rounded-md p-2 md:px-1.5 md:py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="size-3" />
        </a>
      )}
      <DeleteMessageDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        channel={channel}
        onConfirm={runDelete}
      />
      <CommentDmDialog
        open={dmOpen}
        onOpenChange={setDmOpen}
        messageId={message.id}
        commentText={message.content_text ?? ""}
      />
    </div>
  );
}

function labelFor(action: string, t: TFn): string {
  switch (action) {
    case "hide":
      return t("inbox.moderationHidden");
    case "unhide":
      return t("inbox.moderationVisible");
    case "like":
      return t("inbox.moderationLiked");
    case "unlike":
      return t("inbox.moderationUnliked");
    case "delete":
      return t("inbox.moderationDeleted");
    default:
      return t("inbox.moderationDone");
  }
}
