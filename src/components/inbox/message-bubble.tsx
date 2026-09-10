"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type MouseEvent,
  type ReactNode,
} from "react";
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
  Mic,
  EyeOff,
  Download,
} from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { useTimezone } from "@/hooks/use-timezone";
import { useT } from "@/hooks/use-locale";
import { deliveryErrorKey } from "@/lib/whatsapp/delivery-errors";
import {
  COMMENT_DELETED_TEXT,
  channelLabel,
  isUnsupportedSnippet,
  isUnsupportedMediaSnippet,
  isCommentDeleted,
  localizeContentToken,
  stripLeadingMentions,
} from "@/lib/channels/display";
import { findLinks } from "@/lib/inbox/linkify";
import { downloadMedia } from "@/lib/inbox/download";
import { PhoneActions } from "./phone-actions";
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
  /** Nombre del contacto — lo hereda el atajo de WhatsApp para nombrar el
   *  contacto nuevo cuando el cliente deja su teléfono escrito. */
  contactName?: string | null;
  contactPhone?: string | null;
  onToggleReaction?: (emoji: string) => void;
  /** Para que la barra de moderación pueda sacar la burbuja al borrar. */
  onDeleted?: () => void;
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
    | "status"
    | "error_reason"
    | "error_code"
    | "held_for_quality"
    | "delivery_unconfirmed_at"
    | "channel"
    | "content_text"
  >,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  const confirmed = message.status === "delivered" || message.status === "read";
  if (message.status === "failed") {
    // BORRADO NO ES FALLIDO.
    //
    // `status: 'failed'` + el centinela de texto es como `comment-sync` marca
    // un comentario borrado (no hay columna propia). Acá se leía como una
    // entrega que falló, así que un comentario que alguien borró a propósito
    // salía en rojo — y encima con el motivo de abajo, que habla de WhatsApp.
    if ((message.content_text ?? "").trim() === COMMENT_DELETED_TEXT) return null;
    const key = deliveryErrorKey(message.error_code);
    if (key) return t(key, { code: message.error_code ?? "" });
    if (message.error_reason) return message.error_reason;
    // El "no informó el motivo" nombra a WhatsApp, y se mostraba en cualquier
    // canal: un comentario de Instagram decía "WhatsApp no entregó el mensaje"
    // (visto el 2026-08-30). Fuera de WhatsApp, algo neutro y cierto.
    return message.channel === "whatsapp"
      ? t("deliveryErrors.noReason")
      : t("deliveryErrors.noReasonOtro");
  }
  if (!confirmed && message.held_for_quality) return t("deliveryErrors.held");
  if (unconfirmedWhatsApp(message)) return t("deliveryErrors.unconfirmed");
  return null;
}

/**
 * "Enviado, pero WhatsApp no confirmó la entrega" sólo tiene sentido en
 * WhatsApp. El resto de los canales no manda acuse: su saliente se queda en
 * 'sent' por diseño, y mostrar ahí una alerta de WhatsApp llenaba de triángulos
 * ámbar hilos de Mercado Libre, Instagram y correo donde no pasaba nada. El
 * cron ya no los marca; esto además tapa las filas que quedaron marcadas antes.
 */
function unconfirmedWhatsApp(
  message: Pick<Message, "status" | "delivery_unconfirmed_at" | "channel">,
): boolean {
  return (
    message.channel === "whatsapp" &&
    message.status === "sent" &&
    Boolean(message.delivery_unconfirmed_at)
  );
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
  if (unconfirmedWhatsApp(message)) {
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

/** La plataforma avisó que hay contenido y no lo entrega: el ver-una-vez y el
 *  modo temporal de Instagram, una nota de voz de IG, un GIF, algo de una cuenta
 *  privada. Se dice explícito —y con el nombre del canal— para que el agente
 *  sepa que hay un mensaje real y lo abra ahí. */
function UnsupportedMedia({ channel }: { channel: Message["channel"] }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Mic className="h-4 w-4 shrink-0" />
      <span>{t("inbox.unsupportedMedia", { channel: channelLabel(channel, t) })}</span>
    </div>
  );
}

/**
 * Guardar el archivo en el disco. Va sobre la miniatura (imagen/video) o al
 * lado del reproductor de audio, y sirve igual para lo recibido y lo enviado:
 * la burbuja es la misma en las dos direcciones.
 */
function DownloadButton({
  url,
  name,
  fallbackName,
  blobUrl,
  variant = "overlay",
  className,
}: {
  url: string;
  name?: string;
  fallbackName: string;
  /** Blob que la burbuja ya bajó para mostrar la imagen: se reusa. */
  blobUrl?: string | null;
  variant?: "overlay" | "inline";
  className?: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function handleClick(e: MouseEvent) {
    // La miniatura está dentro de un botón que abre el visor: sin
    // esto, descargar también abriría el visor.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await downloadMedia(url, name, fallbackName, blobUrl);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={t("inbox.download")}
      aria-label={t("inbox.download")}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition disabled:opacity-50",
        variant === "overlay"
          ? "absolute right-1.5 top-1.5 bg-black/55 text-white opacity-70 backdrop-blur-sm hover:bg-black/75 hover:opacity-100 group-hover:opacity-100"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <Download className="h-3.5 w-3.5" />
    </button>
  );
}

function MediaImage({ url, alt, name }: { url: string; alt: string; name?: string }) {
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
    <div ref={wrapRef} className="group relative w-fit">
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
      <DownloadButton
        url={url}
        name={name}
        fallbackName={t("inbox.image")}
        blobUrl={src}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[95vw]">
          <img
            src={src ?? ""}
            alt={alt}
            className="mx-auto max-h-[90vh] max-w-[95vw] object-contain"
          />
          {/* right-12: deja libre la X de cerrar, que vive en top-2 right-2. */}
          <DownloadButton
            url={url}
            name={name}
            fallbackName={t("inbox.image")}
            blobUrl={src}
            className="right-12 top-2 opacity-100"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MediaVideo({ url, name }: { url: string; name?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="group relative w-fit">
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
      <DownloadButton url={url} name={name} fallbackName={t("inbox.video")} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[95vw]">
          <video
            src={url}
            controls
            autoPlay
            className="mx-auto max-h-[90vh] max-w-[95vw]"
          />
          <DownloadButton
            url={url}
            name={name}
            fallbackName={t("inbox.video")}
            className="right-12 top-2 opacity-100"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Nota de voz o audio: reproductor + guardar. */
function MediaAudio({ url, name }: { url: string; name?: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1">
      <audio src={url} controls className="max-w-60" />
      <DownloadButton
        url={url}
        name={name}
        fallbackName={t("inbox.audio")}
        variant="inline"
      />
    </div>
  );
}

/** Archivo sin vista previa: la fila entera lo guarda en el disco. */
function MediaFile({
  url,
  name,
  label,
}: {
  url: string;
  name?: string;
  label: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      title={t("inbox.download")}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await downloadMedia(url, name, t("inbox.file"));
        } finally {
          setBusy(false);
        }
      }}
      className="flex w-full items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
    >
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      <Download className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
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
 *  ("image", "video", "audio", "file") older rows stored. Cuando el mime no
 *  dice nada (`application/octet-stream`, como manda el CDN de Meta para
 *  varias notas de voz) decide la extensión del archivo — si no, una nota de
 *  voz vieja se ve como enlace de descarga en vez de reproductor. */
function attachmentKind(
  mime?: string,
  url?: string,
): "image" | "video" | "audio" | "file" {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image")) return "image";
  if (m.startsWith("video")) return "video";
  if (m.startsWith("audio")) return "audio";
  const ext = (url ?? "").toLowerCase().split(/[?#]/)[0].split(".").pop() ?? "";
  if (["ogg", "oga", "opus", "mp3", "m4a", "aac", "amr", "wav", "weba", "flac", "3ga"].includes(ext)) {
    return "audio";
  }
  if (["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "3gp", "avi"].includes(ext)) return "video";
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
        const url = safeMediaUrl(a.url);
        const kind = attachmentKind(a.mime_type, a.url);
        if (!url) {
          return (
            <span key={i} className="text-sm text-muted-foreground">
              {t("inbox.attachmentUnavailable", { name: a.name || t("inbox.file") })}
            </span>
          );
        }
        if (kind === "image") {
          return (
            <MediaImage
              key={i}
              url={url}
              alt={a.name || t("inbox.sharedImage")}
              name={a.name}
            />
          );
        }
        if (kind === "video") {
          return <MediaVideo key={i} url={url} name={a.name} />;
        }
        if (kind === "audio") {
          return <MediaAudio key={i} url={url} name={a.name} />;
        }
        return (
          <MediaFile
            key={i}
            url={url}
            name={a.name}
            label={a.name || t("inbox.file")}
          />
        );
      })}
      {caption && !isTypePlaceholder(caption) && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{linkifyNodes(caption)}</p>
      )}
    </div>
  );
}

/**
 * Convierte en enlaces clicables las URL y correos del texto de un mensaje, en
 * CUALQUIER canal — con esquema, con www o a secas ("pilarargentina.store"),
 * que es como los escribe la gente. Heredan el color de la burbuja con
 * subrayado para que se lean tanto en la del agente (primary) como en la del
 * cliente. La detección vive en lib/inbox/linkify (pura y testeada).
 */
function linkifyNodes(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const link of findLinks(text)) {
    if (link.start > last) nodes.push(text.slice(last, link.start));
    nodes.push(
      <a
        key={key++}
        href={link.href}
        target={link.isEmail ? undefined : "_blank"}
        rel={link.isEmail ? undefined : "noopener noreferrer"}
        className="underline underline-offset-2 break-all hover:opacity-80"
      >
        {link.text}
      </a>,
    );
    if (link.trailing) nodes.push(link.trailing);
    last = link.end;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function MessageContent({
  message,
  contactName,
  contactPhone,
}: {
  message: Message;
  contactName?: string | null;
  contactPhone?: string | null;
}) {
  const t = useT();
  // Teléfono que dejó el cliente → atajo para seguir por WhatsApp. Sólo en
  // mensajes entrantes: un número en un mensaje nuestro es el nuestro.
  const phoneActions =
    message.sender_type === "customer" ? (
      <PhoneActions
        text={message.content_text}
        contactName={contactName}
        contactPhone={contactPhone}
      />
    ) : null;
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
    case "text": {
      // Un marcador de tipo ("[Ubicación]") se muestra en el idioma del
      // usuario; el resto del texto sale tal cual. Sin nada que mostrar
      // (mensaje sin cuerpo ni archivo, o un tipo que la plataforma no nos
      // deja leer) va el rótulo — nunca una burbuja en blanco: en la bandeja
      // todo mensaje se ve.
      const body = message.content_text?.trim();
      if (isUnsupportedMediaSnippet(body)) return <UnsupportedMedia channel={message.channel} />;
      const readable = body && !isUnsupportedSnippet(body);
      return (
        <div>
          <p className="whitespace-pre-wrap break-words text-sm">
            {readable
              ? linkifyNodes(localizeContentToken(message.content_text, t))
              : t("inbox.unsupported", { channel: channelLabel(message.channel, t) })}
          </p>
          {readable && phoneActions}
        </div>
      );
    }

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
              {linkifyNodes(message.content_text)}
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
              {linkifyNodes(message.content_text)}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {mediaUrl ? (
            <MediaAudio url={mediaUrl} />
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
        <MediaFile
          url={mediaUrl}
          label={message.content_text || t("inbox.document")}
        />
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
              {linkifyNodes(message.content_text)}
            </p>
          )}
          <TemplateButtons message={message} />
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="whitespace-pre-wrap break-words">
            {message.content_text
              ? linkifyNodes(localizeContentToken(message.content_text, t))
              : t("inbox.sharedLocation")}
          </span>
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
            {message.content_text ? linkifyNodes(message.content_text) : t("inbox.interactiveReply")}
          </p>
          <TemplateButtons message={message} />
        </div>
      );
    }

    default: {
      if (isUnsupportedMediaSnippet(message.content_text)) return <UnsupportedMedia channel={message.channel} />;
      // Acá caen, entre otros, los comentarios de Facebook/Instagram: dejar
      // el teléfono en un comentario es de lo más común para pedir precio.
      // El "@usuario" con el que IG/FB encabezan cada respuesta de un hilo no
      // se muestra: el hilo ya dice quién habla y a qué contesta. Se saca sólo
      // de la vista — el texto publicado lo conserva, porque de esa mención
      // depende que a la persona le llegue la notificación.
      const commentText = isCommentChannel(message.channel)
        ? stripLeadingMentions(message.content_text)
        : message.content_text;
      return (
        <div>
          <p className="whitespace-pre-wrap break-words text-sm">
            {isUnsupportedSnippet(message.content_text)
              ? t("inbox.unsupported", { channel: channelLabel(message.channel, t) })
              : commentText
                ? linkifyNodes(commentText)
                : // No es que el canal lo haya retenido: la fila entró sin texto
                  // —un comentario que era sólo una foto o un sticker—. Decir
                  // "no lo entrega" ahí era inventar un diagnóstico.
                  t("inbox.noContent")}
          </p>
          {message.content_text && !isUnsupportedSnippet(message.content_text)
            ? phoneActions
            : null}
        </div>
      );
    }
  }
}

/** Canales donde el cuerpo es un comentario público, no un mensaje 1:1. */
function isCommentChannel(channel: Message["channel"]): boolean {
  return (
    channel === "fb_comment" ||
    channel === "ig_comment" ||
    channel === "tiktok_comment"
  );
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
              className="flex items-center justify-center gap-1.5 rounded-md bg-black px-2 py-1.5 text-xs font-medium text-white hover:bg-black/85"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </a>
          );
        }
        return (
          <div
            key={i}
            className="flex items-center justify-center gap-1.5 rounded-md bg-black px-2 py-1.5 text-xs font-medium text-white"
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
  const rawText = message.content_text ?? "";
  const { primary, quoted } = splitEmailQuote(rawText);

  if (emailIsHtml(message)) {
    // Sólo el correo, tal cual llegó. La parte de texto plano de un correo
    // con diseño es la misma información otra vez —encabezado, pie legal,
    // enlace de baja— apilada encima del correo real. El texto nuevo de una
    // respuesta también viene dentro del HTML, arriba de la cita, así que no
    // se pierde nada al no repetirlo.
    return <EmailHtmlBody html={(message.html_body as string).trim()} />;
  }

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
  // Antes una respuesta se degradaba a texto pelado aunque el correo
  // tuviera diseño. Ahora se conserva el HTML y el mensaje nuevo va arriba
  // (ver EmailBody): se ve lo que la persona escribió sin perder el correo.
  // Una respuesta SIN diseño —prosa y nada más— sigue yendo como texto,
  // que es como se lee mejor.
  return isRichHtml(html);
}

/** Plain text with bare http(s) URLs turned into clickable links (emails). */
function LinkifiedText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {linkifyNodes(text)}
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
export function splitEmailQuote(raw: string): { primary: string; quoted: string } {
  const decoded = decodeHtmlEntities(raw).replace(/\r\n/g, "\n");

  const inlineMarkers: RegExp[] = [
    // Gmail / Apple Mail: "El <día>, <fecha> … escribió:". Anchored on a
    // weekday + day-number so a stray "El lunes" in prose can't trip it.
    /El\s+(?:lun|mar|mi[eé]|jue|vie|s[aá]b|dom)[a-zé.]*,?\s+\d{1,2}\b[\s\S]*?escribi[oó]:/i,
    // English: "On <weekday>, <date> … wrote:".
    /On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[\s\S]*?\bwrote:/i,
    // Apple Mail en iOS/macOS cita SIN día de la semana:
    // "El 13 ago 2026, a la(s) 12:58 a. m., Fulano <x@y> escribió:".
    // Sin esta variante la cita no se detectaba, así que el mensaje nuevo
    // no se podía separar del correo citado y quedaba enterrado.
    /El\s+\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z.]*\s+\d{4}[\s\S]{0,400}?escribi[o\u00f3]:/i,
    // Las mismas, en inglés, en los dos órdenes que usan los clientes.
    /On\s+\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}[\s\S]{0,400}?\bwrote:/i,
    /On\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*\d{4}[\s\S]{0,400}?\bwrote:/i,
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
  contactName,
  contactPhone,
  onToggleReaction,
  onDeleted,
}: MessageBubbleProps) {
  const t = useT();
  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const tz = useTimezone();
  const time = formatInTimeZone(new Date(message.created_at), tz, "HH:mm");

  // Los comentarios de FB/IG/TikTok se leen en burbujas de chat, igual que el
  // resto de la bandeja.
  const isComment =
    message.channel === "fb_comment" ||
    message.channel === "ig_comment" ||
    message.channel === "tiktok_comment";

  /** Escondido del público en la red, pero acá se sigue leyendo entero. */
  const ocultoEnMeta = isComment && message.is_hidden === true && !isCommentDeleted(message);

  /**
   * Y quién lo ocultó (migración 212). "Lo ocultó la IA" y "lo ocultó tu
   * equipo" llevan a decisiones distintas: la primera se revisa en Comentarios,
   * la segunda no se revisa. Los comentarios ocultados antes de la migración no
   * tienen autor y se quedan con el aviso a secas.
   */
  const quienOculto = !ocultoEnMeta
    ? null
    : message.hidden_by === "ia"
      ? t("inbox.hiddenByAi")
      : message.hidden_by === "persona"
        ? t("inbox.hiddenByTeam")
        : message.hidden_by === "red"
          ? t("inbox.hiddenByNetwork", {
              red:
                message.channel === "fb_comment"
                  ? "Facebook"
                  : message.channel === "tiktok_comment"
                    ? "TikTok"
                    : "Instagram",
            })
          : null;

  // Email channels render as full-width cards rather than chat bubbles —
  // an email thread reads better as stacked messages with an explicit
  // "Tú / cliente" header and a color-coded side rail than as left/right
  // speech bubbles. Outbound (our replies) get a primary rail on the
  // right; inbound (client) gets a slate rail on the left.
  if (message.channel === "gmail" || message.channel === "outlook" || message.channel === "zoho") {
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
          // Oculto en Instagram/Facebook: el comentario sigue entero acá —lo
          // que dijo la persona no se pierde por haberlo escondido del
          // público— pero la burbuja tiene que leerse distinta de un rato.
          // Con el chip solo dentro de la barra de moderación había que
          // fijarse para notarlo, y quien mira el hilo necesita saber al pasar
          // que eso ya no lo ve nadie más.
          ocultoEnMeta && "opacity-70 ring-1 ring-inset ring-amber-500/40",
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
        {/* La lápida vale para cualquier canal, no sólo comentarios: desde
            que WhatsApp e Instagram avisan que borraron un mensaje, un DM
            eliminado tiene que verse eliminado. La palabra cambia porque un
            comentario y un mensaje no son lo mismo para quien lee. */}
        {isCommentDeleted(message) ? (
          <span className="text-sm italic opacity-70">
            {t(isComment ? "inbox.commentDeleted" : "inbox.messageRemoved")}
          </span>
        ) : (
          <>
            {/* Qué cambió, dicho antes del texto: el comentario está ahí, lo
                que dejó de estar es a la vista del público. */}
            {ocultoEnMeta && (
              <p className="mb-1 flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <EyeOff className="size-3" aria-hidden />
                {t("inbox.commentHiddenNotice")}
                {quienOculto && (
                  <span className="font-normal opacity-70">· {quienOculto}</span>
                )}
              </p>
            )}
            <MessageContent message={message} contactName={contactName} contactPhone={contactPhone} />
          </>
        )}
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
          {message.edited_at && (
            <span
              className={cn(
                "text-[10px]",
                isAgent ? "text-primary-foreground/60" : "text-muted-foreground",
              )}
            >
              {t("inbox.editedMark")}
            </span>
          )}
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
      {!isCommentDeleted(message) &&
        (message.channel === "fb_comment" ||
          message.channel === "ig_comment" ||
          message.channel === "tiktok_comment") && (
          <CommentModerationBar
            message={message}
            channel={message.channel}
            own={message.sender_type !== "customer"}
            onDeleted={onDeleted}
          />
        )}
    </div>
  );
}
