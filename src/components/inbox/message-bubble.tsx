"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction, MessageAttachment } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  AlertTriangle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  ExternalLink,
  Phone,
} from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { useTimezone } from "@/hooks/use-timezone";
import { useT } from "@/hooks/use-locale";
import { useCommentView } from "@/hooks/use-comment-view";
import { deliveryErrorKey } from "@/lib/whatsapp/delivery-errors";
import { isUnsupportedSnippet } from "@/lib/channels/display";
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
  /** For comment channels in the native view: the comment author's display
   *  name + avatar (the commenter for customer comments, the page for agent
   *  replies). Ignored outside the native comment layout. */
  commentAuthorName?: string;
  commentAuthorAvatarUrl?: string | null;
  onToggleReaction?: (emoji: string) => void;
}

/**
 * Motivo de entrega legible y LOCALIZADO para un mensaje saliente:
 *  - failed → texto del código de Meta (deliveryErrors), o el crudo, o el
 *    honesto "no informó el motivo" cuando Meta calla.
 *  - sent + delivery_unconfirmed_at → "enviado pero sin confirmar" (watchdog).
 *  - held_for_quality → "en revisión de calidad" (pacing de plantilla nueva).
 * Devuelve null cuando no hay nada que explicar (entrega normal).
 */
function deliveryReasonText(
  message: Pick<
    Message,
    "status" | "error_reason" | "error_code" | "held_for_quality" | "delivery_unconfirmed_at"
  >,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  const confirmed = message.status === "delivered" || message.status === "read";
  if (message.status === "failed") {
    const key = deliveryErrorKey(message.error_code);
    if (key) return t(key, { code: message.error_code ?? "" });
    if (message.error_reason) return message.error_reason;
    return t("deliveryErrors.noReason");
  }
  if (!confirmed && message.held_for_quality) return t("deliveryErrors.held");
  if (message.status === "sent" && message.delivery_unconfirmed_at) {
    return t("deliveryErrors.unconfirmed");
  }
  return null;
}

function StatusIcon({ message }: { message: Message }) {
  const t = useT();
  const reason = deliveryReasonText(message, t);
  const confirmed = message.status === "delivered" || message.status === "read";
  // Retención por pacing: la fila sigue en 'sent' pero mostramos un reloj ámbar
  // (no un check gris mudo) para señalar "en revisión de calidad".
  if (!confirmed && message.held_for_quality) {
    return (
      <span title={reason ?? undefined} className="inline-flex">
        <Clock className="h-3 w-3 text-amber-500" />
      </span>
    );
  }
  // Enviado pero sin confirmar (watchdog): triángulo ámbar de alerta suave.
  if (message.status === "sent" && message.delivery_unconfirmed_at) {
    return (
      <span title={reason ?? undefined} className="inline-flex">
        <AlertTriangle className="h-3 w-3 text-amber-500" />
      </span>
    );
  }
  switch (message.status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-600 dark:text-blue-400" />;
    case "failed":
      return (
        <span title={reason ?? undefined} className="inline-flex">
          <XCircle className="h-3 w-3 text-red-600 dark:text-red-400" />
        </span>
      );
    default:
      return null;
  }
}

function MediaUnavailable({ label }: { label: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("inbox.mediaUnavailable", { label })}</span>
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const t = useT();
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
        aria-label={t("inbox.expandImage")}
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
        <DialogContent className="max-w-[95vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[95vw]">
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
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-zoom-in"
        aria-label={t("inbox.expandVideo")}
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
        <DialogContent className="max-w-[95vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[95vw]">
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

/** Los adaptadores guardan un marcador tipo "[Audio]" / "[Imagen]" como
 *  content_text para que el preview de la lista tenga algo que mostrar. En
 *  la burbuja ese texto sobra: ya se ve el reproductor o la imagen, así que
 *  imprimirlo debajo solo agrega ruido. Un pie real jamás es exactamente un
 *  token entre corchetes. */
function isTypePlaceholder(caption: string): boolean {
  return /^\[[^\]]+\]$/.test(caption.trim());
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
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      {attachments.map((a, i) => {
        const kind = attachmentKind(a.mime_type);
        const url = safeMediaUrl(a.url);
        if (!url) {
          return (
            <span key={i} className="text-sm text-muted-foreground">
              {t("inbox.attachmentUnavailable", { name: a.name || t("inbox.file") })}
            </span>
          );
        }
        if (kind === "image") {
          return <MediaImage key={i} url={url} alt={a.name || t("inbox.sharedImage")} />;
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
            <span className="truncate">{a.name || t("inbox.file")}</span>
          </a>
        );
      })}
      {caption && !isTypePlaceholder(caption) && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{caption}</p>
      )}
    </div>
  );
}

function MessageContent({ message }: { message: Message }) {
  const t = useT();
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
            <MediaImage url={mediaUrl} alt={t("inbox.sharedImage")} />
          ) : (
            <MediaUnavailable label={t("inbox.image")} />
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
            <MediaUnavailable label={t("inbox.video")} />
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
            <MediaUnavailable label={t("inbox.audio")} />
          )}
        </div>
      );

    case "document":
      if (!mediaUrl) {
        return <MediaUnavailable label={message.content_text || t("inbox.document")} />;
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
            {message.content_text || t("inbox.document")}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-accent-ink">
            <LayoutTemplate className="h-3 w-3" />
            {/* Muestra el NOMBRE de la plantilla junto al chip: así una fila sin
                cuerpo guardado (envíos viejos) igual identifica qué se mandó,
                en vez de una burbuja "vacía". */}
            {message.template_name
              ? `${t("inbox.template")} · ${message.template_name}`
              : t("inbox.template")}
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
          <TemplateButtons message={message} />
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("inbox.sharedLocation")}</span>
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
            {t("inbox.buttonReply")}
          </span>
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.content_text || t("inbox.interactiveReply")}
          </p>
          <TemplateButtons message={message} />
        </div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {isUnsupportedSnippet(message.content_text)
            ? t("inbox.unsupported")
            : message.content_text || t("inbox.unsupported")}
        </p>
      );
  }
}

/**
 * Botones de un mensaje saliente (plantilla / CTA de flujo). Se guardan
 * resueltos en `messages.buttons` (migración 112): los URL ya traen el enlace
 * real (short link), así el agente ve y puede abrir lo mismo que recibió el
 * cliente. Los quick-reply se muestran informativos (no accionables desde acá).
 */
function TemplateButtons({ message }: { message: Message }) {
  const buttons = message.buttons;
  if (!Array.isArray(buttons) || buttons.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border/40 pt-2">
      {buttons.map((b, i) => {
        const label = (b?.text || "").trim();
        if (!label) return null;
        if (b.type === "URL" && b.url) {
          return (
            <a
              key={i}
              href={b.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-md bg-background/60 px-2 py-1.5 text-xs font-medium text-accent-ink hover:bg-background"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </a>
          );
        }
        return (
          <div
            key={i}
            className="flex items-center justify-center gap-1.5 rounded-md bg-background/40 px-2 py-1.5 text-xs font-medium text-muted-foreground"
          >
            {b.type === "PHONE_NUMBER" ? (
              <Phone className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <CornerDownLeft className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Email body renderer. How an email reads depends on its type:
 *
 *   - A REPLY in a back-and-forth (we can detect a quoted history) is
 *     really just the few lines the person wrote. Rendering its raw HTML
 *     is an awkward white box wrapping that text plus the whole quoted
 *     chain — so we show only the new text, cleanly, with links live.
 *   - A STANDALONE designed email (newsletter, receipt, notification)
 *     has no quote and is built to be seen — render its real HTML so it
 *     looks exactly like it does in a mail client (logos, hero images,
 *     buttons, layout).
 *   - Anything without a usable HTML body falls back to plain text.
 */
function EmailBody({ message }: { message: Message }) {
  const t = useT();
  if (emailIsHtml(message)) {
    return <EmailHtmlBody html={(message.html_body as string).trim()} />;
  }
  const rawText = message.content_text ?? "";
  const { primary, quoted } = splitEmailQuote(rawText);
  const isReply = quoted.length > 0;
  const text = isReply
    ? primary
    : decodeHtmlEntities(rawText).replace(/\r\n/g, "\n").trim();
  return <LinkifiedText text={text || t("inbox.noContent")} />;
}

/** True for emails built as designed HTML (marketing/transactional):
 *  they lay out with images and/or tables. Plain prose replies have
 *  neither, so this cleanly separates "show the HTML" from "show text". */
function isRichHtml(html: string): boolean {
  return /<img\b/i.test(html) || /<table\b/i.test(html);
}

/** Whether this email renders as its real HTML (a designed, standalone
 *  email) vs as plain text (a reply / bare note). Used both to pick the
 *  renderer AND to size the card: HTML emails want a wide column, text
 *  replies want a chat-bubble that shrinks to content. */
function emailIsHtml(message: Message): boolean {
  const html = message.html_body?.trim();
  if (!html) return false;
  const { quoted } = splitEmailQuote(message.content_text ?? "");
  if (quoted.length > 0) return false; // it's a reply → show the text
  return isRichHtml(html);
}

/** Plain text with bare http(s) URLs turned into clickable links. */
function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-accent-ink underline underline-offset-2 hover:text-accent-ink/80"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/**
 * Render an email's real HTML body so it reads exactly like it does in a
 * mail client, instead of a flattened-text approximation.
 *
 * The HTML is untrusted, so it renders inside a sandboxed <iframe>:
 *   - NO `allow-scripts` → no email JavaScript ever runs, so this is
 *     XSS-safe even for hostile mail.
 *   - `allow-same-origin` → lets the parent read the document height to
 *     size the frame. Safe precisely because scripts are disabled: the
 *     classic allow-scripts+allow-same-origin sandbox-escape can't apply.
 *   - `allow-popups` + injected `<base target="_blank">` → links open in a
 *     new tab rather than navigating the inbox.
 * The frame auto-grows to its content via a ResizeObserver on the body
 * (so it keeps up as remote images finish loading).
 */
function EmailHtmlBody({ html }: { html: string }) {
  const t = useT();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<base target="_blank">` +
      `<style>` +
      // Kill self-sizing tricks: emails that set html/body height:100% or
      // min-height:100vh otherwise inflate the iframe and leave a white gap
      // below the content. Force auto height so our measurement is honest.
      `html,body{margin:0!important;padding:0!important;height:auto!important;min-height:0!important;background:#fff;}` +
      `body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
      `font-size:14px;line-height:1.5;color:#1a1a1a;overflow-wrap:break-word;}` +
      // Fit media/tables to the frame width without breaking words mid-letter.
      `img{max-width:100%;height:auto;}a{color:#2563eb;}` +
      `</style></head><body>${html}</body></html>`,
    [html],
  );

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body || !doc.documentElement) return;
    // Take the largest of every height signal — image-heavy emails (e.g. a
    // big hero logo) measure short until the image loads, so under-measuring
    // would clip them ("no se ven").
    const h = Math.max(
      doc.body.scrollHeight,
      doc.body.offsetHeight,
      doc.documentElement.scrollHeight,
      doc.documentElement.offsetHeight,
    );
    if (h > 0) setHeight(Math.min(h, 20000));
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const onLoad = () => {
      measure();
      const doc = frame.contentDocument;
      if (doc?.documentElement) {
        ro?.disconnect();
        ro = new ResizeObserver(() => measure());
        // Observe both: documentElement catches width-reflow, body catches
        // content growth as remote images/fonts finish loading.
        ro.observe(doc.documentElement);
        if (doc.body) ro.observe(doc.body);
      }
      // Backstop for late images that don't trigger an observed resize.
      [150, 500, 1200, 2500].forEach((ms) =>
        timers.push(setTimeout(measure, ms)),
      );
    };

    frame.addEventListener("load", onLoad);
    // srcDoc may already be parsed by the time the effect runs.
    if (frame.contentDocument?.readyState === "complete") onLoad();
    // Panel/window resize changes the frame width → content reflows taller.
    const onResize = () => measure();
    window.addEventListener("resize", onResize);

    return () => {
      frame.removeEventListener("load", onLoad);
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [measure, srcDoc]);

  return (
    <iframe
      ref={frameRef}
      title={t("inbox.email")}
      sandbox="allow-same-origin allow-popups"
      srcDoc={srcDoc}
      scrolling="no"
      className="w-full rounded border-0 bg-white"
      style={{ height }}
    />
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

/**
 * Split an email's plain-text body into the new content and the quoted
 * reply chain below it. Used to (a) decide whether a message is a reply
 * at all and (b) show only the new lines for replies. Detects the quote
 * intro inline — not just at line start — so it also folds legacy rows
 * whose HTML was flattened to a single line at ingest time.
 */
function splitEmailQuote(raw: string): { primary: string; quoted: string } {
  const decoded = decodeHtmlEntities(raw).replace(/\r\n/g, "\n");

  const inlineMarkers: RegExp[] = [
    // Gmail / Apple Mail: "El <día>, <fecha> … escribió:". Anchored on a
    // weekday + day-number so a stray "El lunes" in prose can't trip it.
    /El\s+(?:lun|mar|mi[eé]|jue|vie|s[aá]b|dom)[a-zé.]*,?\s+\d{1,2}\b[\s\S]*?escribi[oó]:/i,
    // English: "On <weekday>, <date> … wrote:".
    /On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[\s\S]*?\bwrote:/i,
    // Outlook reply header block: "De: … Enviado: …" / "From: … Sent: …".
    /\bDe:\s[\s\S]{0,400}?\bEnviado(?:\s+el)?:/i,
    /\bFrom:\s[\s\S]{0,400}?\bSent:/i,
    // Outlook mobile signature that precedes the quoted header block.
    /Obtener\s+Outlook\s+para\s+\w+/i,
    /Get\s+Outlook\s+for\s+\w+/i,
    // Other mobile signatures.
    /Enviado\s+desde\s+mi\s+\w+/i,
    /Sent\s+from\s+my\s+\w+/i,
    // Classic separators inserted by Outlook / forwarders.
    /-{2,}\s*(?:Original\s*Message|Mensaje\s*original)\s*-{2,}/i,
  ];
  // ">"-quoted plain-text replies (only meaningful at a line start).
  const lineMarkers: RegExp[] = [/^>+ /m];

  let cutAt = decoded.length;
  for (const m of [...inlineMarkers, ...lineMarkers]) {
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
  commentAuthorName,
  commentAuthorAvatarUrl,
  onToggleReaction,
}: MessageBubbleProps) {
  const t = useT();
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const tz = useTimezone();
  const time = formatInTimeZone(new Date(message.created_at), tz, "HH:mm");
  const { commentView } = useCommentView();

  // Native comment view: FB/IG/TikTok comments render like the source app —
  // avatar + author + a rounded comment, page replies nested under the
  // commenter. Toggled in Ajustes → Apariencia; default is native.
  const isComment =
    message.channel === "fb_comment" ||
    message.channel === "ig_comment" ||
    message.channel === "tiktok_comment";
  if (isComment && commentView === "native") {
    return (
      <NativeComment
        message={message}
        authorName={commentAuthorName ?? (isAgent ? t("inbox.you") : t("inbox.customer"))}
        avatarUrl={commentAuthorAvatarUrl ?? null}
        isPage={isAgent}
      />
    );
  }

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
    const asHtml = emailIsHtml(message);
    return (
      <div className={cn("flex w-full", isAgent ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "rounded-lg border bg-card/40",
            // Rail on the sender's side, like a chat bubble.
            isAgent
              ? "border-r-2 border-r-primary border-border/60"
              : "border-l-2 border-l-border border-border/60",
            // Designed emails get a wide column (fits a 600px layout); text
            // replies shrink to content like a normal chat bubble.
            asHtml ? "w-full max-w-[680px]" : "max-w-[88%] sm:max-w-[600px]",
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
              {isAgent ? (senderName ?? t("inbox.you")) : t("inbox.customer")}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {fullTime}
              {isAgent && (
                <StatusIcon message={message} />
              )}
            </span>
          </div>
          <div className="px-3 py-2 text-sm text-foreground">
            {reply && (
              <ReplyQuote authorLabel={reply.authorLabel} preview={reply.preview} />
            )}
            <EmailBody message={message} />
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
          {isAgent && (
            <StatusIcon message={message} />
          )}
        </div>
        {/* Motivo visible (no solo tooltip): el comercio ve POR QUÉ no se
            entregó (o por qué está sin confirmar / en revisión), sin adivinar.
            Localizado y en ámbar para estados no-terminales. */}
        {isAgent &&
          (() => {
            const reason = deliveryReasonText(message, t);
            if (!reason) return null;
            const failed = message.status === "failed";
            return (
              <p
                className={cn(
                  "mt-0.5 text-[10px] leading-tight",
                  failed
                    ? "text-red-600 dark:text-red-400"
                    : "text-amber-600 dark:text-amber-400",
                )}
              >
                {reason}
              </p>
            );
          })()}
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

/**
 * Native comment layout — mirrors the Facebook/Instagram comment thread:
 * a round avatar, the author's name in a rounded comment, and the page's own
 * replies nested (indented) under the commenter with an "Autor" badge. Real
 * moderation (hide / like / delete / open) stays on the existing bar; reply +
 * react come from the hover toolbar (MessageActions) that wraps the row.
 */
function NativeComment({
  message,
  authorName,
  avatarUrl,
  isPage,
}: {
  message: Message;
  authorName: string;
  avatarUrl: string | null;
  isPage: boolean;
}) {
  const t = useT();
  const tz = useTimezone();
  const [imgError, setImgError] = useState(false);
  const when = formatInTimeZone(new Date(message.created_at), tz, "d MMM");
  const initial = (authorName.trim().charAt(0) || "?").toUpperCase();
  const showImg = avatarUrl && !imgError;
  return (
    <div className={cn("flex w-full gap-2", isPage && "pl-7 sm:pl-9")}>
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-foreground">
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <span aria-hidden>{initial}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="inline-block max-w-full rounded-2xl bg-muted px-3 py-2 text-left">
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-foreground">
              {authorName}
            </span>
            {isPage && (
              <span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-medium text-accent-ink">
                {t("inbox.commentAuthorBadge")}
              </span>
            )}
          </div>
          <div className="text-sm text-foreground">
            <MessageContent message={message} />
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-3 text-[11px] font-medium text-muted-foreground">
          <span>{when}</span>
          {message.is_hidden && (
            <span className="text-amber-600 dark:text-amber-400">
              {t("inbox.moderationHidden")}
            </span>
          )}
        </div>
        {(message.channel === "fb_comment" || message.channel === "ig_comment") &&
          message.sender_type === "customer" && (
            <div className="mt-1">
              <CommentModerationBar message={message} channel={message.channel} />
            </div>
          )}
      </div>
    </div>
  );
}
