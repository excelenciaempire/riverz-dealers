"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction, MessageAttachment } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
} from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { useTimezone } from "@/hooks/use-timezone";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { CommentModerationBar } from "./comment-moderation-bar";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  /** Author name to show above the bubble — set for the bot and for
   *  teammates' messages, undefined for the current user's own messages. */
  senderName?: string;
  onToggleReaction?: (emoji: string) => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-600 dark:text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-600 dark:text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{label} no disponible</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  // Gate the blob fetch behind an IntersectionObserver — without this,
  // every bubble in the thread eagerly hits /api/whatsapp/media/ on
  // mount, firing N parallel proxy requests on thread open. We only
  // fetch when the bubble is within 500px of the viewport.
  const [inView, setInView] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Store the blob URL in a ref so the cleanup revokes the URL created
  // BY THIS EFFECT RUN — using the `src` state in cleanup was buggy
  // because it captured whatever `src` happened to be in the closure.
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "500px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView || !url) return;
    let cancelled = false;
    (async () => {
      if (url.startsWith("/api/whatsapp/media/")) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("Failed to load media");
          const blob = await res.blob();
          if (cancelled) return;
          const blobUrl = URL.createObjectURL(blob);
          blobUrlRef.current = blobUrl;
          setSrc(blobUrl);
        } catch {
          if (!cancelled) setError(true);
        } finally {
          if (!cancelled) setLoading(false);
        }
      } else {
        setSrc(url);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [inView, url]);

  if (error) {
    return (
      <div ref={wrapRef} className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div ref={wrapRef} className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Wrap the thumbnail in a button that opens a Dialog-based lightbox.
  // The blob URL is reused so we don't refetch the image for the
  // expanded view; ESC + click-outside come for free from shadcn Dialog.
  return (
    <div ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-zoom-in"
        aria-label="Ampliar imagen"
      >
        <img
          src={src ?? ""}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="max-h-64 max-w-60 rounded-lg object-cover"
          onError={() => setError(true)}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] border-0 bg-transparent p-0 shadow-none">
          <img
            src={src ?? ""}
            alt={alt}
            className="mx-auto max-h-[90vh] max-w-[95vw] object-contain"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MediaVideo({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-zoom-in"
        aria-label="Ampliar video"
      >
        {/* preload="none" prevents the browser from fetching metadata
            for every video in the thread on mount. Without it, opening
            a thread with N videos kicks off N HEAD-style requests against
            our /api/whatsapp/media/ proxy. */}
        <video
          src={url}
          preload="none"
          className="pointer-events-none max-h-64 max-w-60 rounded-lg"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] border-0 bg-transparent p-0 shadow-none">
          <video
            src={url}
            controls
            autoPlay
            className="mx-auto max-h-[90vh] max-w-[95vw]"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Defensa XSS: solo permitimos URLs de adjunto con esquema seguro
 *  (http/https/blob o ruta relativa a nuestro proxy). Hoy las URLs vienen
 *  de Supabase Storage o /api/whatsapp/media/, pero validar el esquema en el
 *  sink evita que una fila legacy/migrada con `javascript:`/`data:text/html`
 *  dispare XSS al usarse como href/src. Devuelve undefined si no es segura. */
function safeMediaUrl(u?: string): string | undefined {
  return u && /^(https?:|blob:|\/)/i.test(u.trim()) ? u : undefined;
}

/** Normalize an attachment's mime to a coarse kind. Handles both the
 *  new real mimes ("image/jpeg") and the legacy channel-type tags
 *  ("image", "video", "audio", "file") older rows stored. */
function attachmentKind(mime?: string): "image" | "video" | "audio" | "file" {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image")) return "image";
  if (m.startsWith("video")) return "video";
  if (m.startsWith("audio")) return "audio";
  return "file";
}

/**
 * Render every file the customer attached (IG/Messenger/WhatsApp media
 * is downloaded to Storage at ingest and lands in `attachments`). Driven
 * by the attachments array — not content_type — so media shows even if
 * the high-level type wasn't bumped, and ALL pieces show, not just the
 * first. The trailing caption is the message's own text, if any.
 */
function AttachmentList({
  attachments,
  caption,
}: {
  attachments: MessageAttachment[];
  caption?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {attachments.map((a, i) => {
        const kind = attachmentKind(a.mime_type);
        const url = safeMediaUrl(a.url);
        if (!url) {
          return (
            <span key={i} className="text-sm text-muted-foreground">
              {a.name || "Archivo"} (no disponible)
            </span>
          );
        }
        if (kind === "image") {
          return <MediaImage key={i} url={url} alt={a.name || "Imagen compartida"} />;
        }
        if (kind === "video") {
          return <MediaVideo key={i} url={url} />;
        }
        if (kind === "audio") {
          return <audio key={i} src={url} controls className="max-w-60" />;
        }
        return (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-accent"
          >
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            <span className="truncate">{a.name || "Archivo"}</span>
          </a>
        );
      })}
      {caption && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{caption}</p>
      )}
    </div>
  );
}

function MessageContent({ message }: { message: Message }) {
  // Attachments first: IG / Messenger / WhatsApp media is re-hosted to
  // Storage at ingest and stored in `attachments`. Rendering from the
  // array (rather than only the derived media_url + content_type) means
  // every photo/video/audio/file the customer sent shows — robustly, and
  // including extra attachments beyond the first. Falls through to the
  // content_type switch below for WhatsApp-legacy rows (media_url proxy,
  // no attachments) and for text/location/template/interactive.
  if (message.attachments && message.attachments.length > 0) {
    return (
      <AttachmentList
        attachments={message.attachments}
        caption={message.content_text ?? undefined}
      />
    );
  }

  // Esquema validado para las filas legacy que usan media_url directo.
  const mediaUrl = safeMediaUrl(message.media_url ?? undefined);

  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {mediaUrl ? (
            <MediaImage url={mediaUrl} alt="Imagen compartida" />
          ) : (
            <MediaUnavailable label="Imagen" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {mediaUrl ? (
            <MediaVideo url={mediaUrl} />
          ) : (
            <MediaUnavailable label="Video" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {mediaUrl ? (
            <audio src={mediaUrl} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label="Audio" />
          )}
        </div>
      );

    case "document":
      if (!mediaUrl) {
        return <MediaUnavailable label={message.content_text || "Documento"} />;
      }
      return (
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-accent"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || "Documento"}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-accent-ink">
            <LayoutTemplate className="h-3 w-3" />
            Plantilla
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || "Ubicación compartida"}</span>
        </div>
      );

    case "interactive": {
      // Customer tapped a reply button or list row on a message the bot
      // sent. We show the tapped option's title (already in content_text,
      // set by parseMessageContent in the webhook) with a small affordance
      // so agents reading the inbox can tell at a glance that this is a
      // tap rather than the customer typing the same words.
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <CornerDownLeft className="h-3 w-3" />
            Respuesta de botón
          </span>
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.content_text || "[Respuesta interactiva]"}
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || "[No compatible]"}
        </p>
      );
  }
}

/**
 * Email body renderer. Two jobs:
 *   1. Decode the HTML entities (&gt;, &nbsp;, …) the raw text body
 *      shows up with after our stripHtml pass at ingest time.
 *   2. Detect the quoted reply chain (everything below "El X escribió:",
 *      "On … wrote:", "From:", "De:", "-----Original Message-----", or
 *      a run of lines starting with ">") and collapse it behind a
 *      toggle, so the visible body is just the new content of THIS
 *      message — like Gmail's "..." quote fold.
 */
function EmailBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { primary, quoted } = splitEmailQuote(text);
  return (
    <div>
      <p className="whitespace-pre-wrap break-words text-sm">
        {primary || (quoted ? "" : "[sin contenido]")}
      </p>
      {quoted && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ···
            {open ? " ocultar cita" : " mostrar cita"}
          </button>
          {open && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/30 p-2 text-[11px] text-muted-foreground">
              {quoted}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|nbsp|#x?\d+);/gi, (full, name) => {
    const key = name.toLowerCase();
    if (HTML_ENTITIES[key]) return HTML_ENTITIES[key];
    // numeric: &#39; or &#x27;
    const num = /^#(x?)(\d+)$/i.exec(name);
    if (num) {
      const code = parseInt(num[2], num[1] ? 16 : 10);
      if (!Number.isNaN(code)) return String.fromCodePoint(code);
    }
    return full;
  });
}

function splitEmailQuote(raw: string): { primary: string; quoted: string } {
  const decoded = decodeHtmlEntities(raw).replace(/\r\n/g, "\n");
  // Common reply-chain markers (Outlook, Gmail, Apple Mail, ES + EN).
  const markers: RegExp[] = [
    /^[ \t>]*El\s+\w+,?\s.+escribi[oó]:\s*$/im,
    /^[ \t>]*On\s.+wrote:\s*$/im,
    /^[ \t>]*-{2,}\s*(Original\s*Message|Mensaje\s*original)\s*-{2,}\s*$/im,
    /^[ \t>]*De:\s.+$/im,
    /^[ \t>]*From:\s.+$/im,
    /^[ \t>]*Enviado\s+desde\s+mi\s+\w+/im,
    /^[ \t>]*Sent\s+from\s+my\s+\w+/im,
    /^[ \t>]*Obtener\s+Outlook\s+para/im,
    /^>+ /m,
  ];
  let cutAt = decoded.length;
  for (const m of markers) {
    const match = decoded.match(m);
    if (match && match.index !== undefined && match.index < cutAt) {
      cutAt = match.index;
    }
  }
  return {
    primary: decoded.slice(0, cutAt).trim(),
    quoted: decoded.slice(cutAt).trim(),
  };
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  senderName,
  onToggleReaction,
}: MessageBubbleProps) {
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const tz = useTimezone();
  const time = formatInTimeZone(new Date(message.created_at), tz, "HH:mm");

  // Email channels render as full-width cards rather than chat bubbles —
  // an email thread reads better as stacked messages with an explicit
  // "Tú / cliente" header and a color-coded side rail than as left/right
  // speech bubbles. Outbound (our replies) get a primary rail on the
  // right; inbound (client) gets a slate rail on the left.
  if (message.channel === "gmail" || message.channel === "outlook") {
    const fullTime = formatInTimeZone(
      new Date(message.created_at),
      tz,
      "d MMM HH:mm",
    );
    return (
      <div className="w-full">
        <div
          className={cn(
            "rounded-lg border bg-card/40",
            isAgent
              ? "border-l-2 border-l-primary border-border/60"
              : "border-l-2 border-l-border border-border/60",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-semibold",
                isAgent ? "text-accent-ink" : "text-foreground",
              )}
            >
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  isAgent ? "bg-primary" : "bg-muted-foreground",
                )}
              />
              {isAgent ? (senderName ?? "Tú") : "Cliente"}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {fullTime}
              {isAgent && <StatusIcon status={message.status} />}
            </span>
          </div>
          <div className="px-3 py-2 text-sm text-foreground">
            {reply && (
              <ReplyQuote authorLabel={reply.authorLabel} preview={reply.preview} />
            )}
            <EmailBody text={message.content_text ?? ""} />
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2">
                <AttachmentList attachments={message.attachments} />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {senderName && (
          <p
            className={cn(
              "mb-0.5 text-[11px] font-semibold",
              isAgent ? "text-primary-foreground/80" : "text-accent-ink",
            )}
          >
            {senderName}
          </p>
        )}
        {reply && (
          <ReplyQuote authorLabel={reply.authorLabel} preview={reply.preview} />
        )}
        <MessageContent message={message} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          <span
            className={cn(
              "text-[10px]",
              isAgent ? "text-primary-foreground/60" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
      {(message.channel === "fb_comment" || message.channel === "ig_comment") &&
        message.sender_type === "customer" && (
          <CommentModerationBar message={message} channel={message.channel} />
        )}
    </div>
  );
}
