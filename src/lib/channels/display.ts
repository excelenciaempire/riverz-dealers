import type { Channel } from "@/types";

export interface ChannelDisplay {
  channel: Channel;
  label: string;
  shortLabel: string;
  /** Tailwind colour class for badges (text + bg + ring). */
  badge: string;
  /** A single tone used for hue accents. */
  accent: string;
  /** True if this channel can only be replied to (no proactive send). */
  replyOnly?: boolean;
}

export const CHANNEL_DISPLAY: Record<Channel, ChannelDisplay> = {
  whatsapp: {
    channel: "whatsapp",
    label: "WhatsApp",
    shortLabel: "WA",
    badge: "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30",
    accent: "#25D366",
  },
  instagram: {
    channel: "instagram",
    label: "Instagram",
    shortLabel: "IG",
    badge: "bg-fuchsia-500/10 text-fuchsia-300 ring-1 ring-fuchsia-500/30",
    accent: "#E1306C",
  },
  messenger: {
    channel: "messenger",
    label: "Messenger",
    shortLabel: "MS",
    badge: "bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/30",
    accent: "#0084FF",
  },
  gmail: {
    channel: "gmail",
    label: "Gmail",
    shortLabel: "GM",
    badge: "bg-red-500/10 text-red-300 ring-1 ring-red-500/30",
    accent: "#EA4335",
  },
  outlook: {
    channel: "outlook",
    label: "Outlook",
    shortLabel: "OL",
    badge: "bg-blue-500/10 text-blue-300 ring-1 ring-blue-500/30",
    accent: "#0078D4",
  },
  fb_comment: {
    channel: "fb_comment",
    label: "Comentarios FB",
    shortLabel: "FB",
    badge: "bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-500/30",
    accent: "#1877F2",
    replyOnly: true,
  },
  ig_comment: {
    channel: "ig_comment",
    label: "Comentarios IG",
    shortLabel: "IG·",
    badge: "bg-pink-500/10 text-pink-300 ring-1 ring-pink-500/30",
    accent: "#C13584",
    replyOnly: true,
  },
  mercadolibre: {
    channel: "mercadolibre",
    label: "Mercado Libre",
    shortLabel: "ML",
    badge: "bg-yellow-400/10 text-yellow-300 ring-1 ring-yellow-400/30",
    accent: "#FFE600",
    replyOnly: true,
  },
  tiktok_comment: {
    channel: "tiktok_comment",
    label: "Comentarios TikTok",
    shortLabel: "TT·",
    badge: "bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/30",
    accent: "#25F4EE",
    replyOnly: true,
  },
  ml_review: {
    channel: "ml_review",
    label: "Opiniones ML",
    shortLabel: "ML·",
    badge: "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/30",
    accent: "#FFE600",
    // Mercado Libre no expone forma de contestar una opinión.
    replyOnly: true,
  },
  voice: {
    channel: "voice",
    label: "Voz",
    shortLabel: "Voz",
    badge: "bg-violet-500/10 text-violet-300 ring-1 ring-violet-500/30",
    accent: "#8B5CF6",
    // No inbox composer — calls are placed by the voice agent, not typed.
    replyOnly: true,
  },
};

export function channelDisplay(channel: Channel): ChannelDisplay {
  return CHANNEL_DISPLAY[channel];
}

/** Sentinel written into a comment's `content_text` when it was deleted —
 *  either by us via the moderation bar (`/api/messages/moderate`) or detected
 *  removed on Facebook/Instagram and synced back (comment-sync / webhook). The
 *  message row is kept (status `failed`) so the thread stays coherent; the UI
 *  swaps the sentinel for a localized "comment deleted" tombstone. Centralised
 *  here so the writers and the reader (message bubble) can't drift. */
export const COMMENT_DELETED_TEXT = "[deleted]";

/** True when a comment row represents a comment that was deleted on the source
 *  platform (or by us). Pure + client-safe so both the inbox UI and the server
 *  sync path share one definition. */
export function isCommentDeleted(message: {
  status?: string | null;
  content_text?: string | null;
}): boolean {
  return (
    message.status === "failed" &&
    (message.content_text ?? "").trim() === COMMENT_DELETED_TEXT
  );
}

/** True for the placeholder text stored when WhatsApp delivers a message type
 *  we can't render ("[unsupported]", "[Unsupported message type: reaction]").
 *  The UI swaps these for the localized `inbox.unsupported` label instead of
 *  showing the raw sentinel. */
export function isUnsupportedSnippet(text?: string | null): boolean {
  if (!text) return false;
  return /^\[unsupported(\]$| media\]$| message type)/i.test(text.trim());
}

/** Caso concreto de lo anterior: Meta avisó `is_unsupported` — la persona SÍ
 *  mandó algo (nota de voz, GIF, contenido de una cuenta privada) pero la
 *  plataforma no lo entrega ni por webhook ni por Graph. La burbuja lo dice
 *  así, en vez de un "[No compatible]" que parece un error nuestro. */
export function isUnsupportedMediaSnippet(text?: string | null): boolean {
  return (text ?? "").trim().toLowerCase() === "[unsupported media]";
}

/**
 * Marcador de tipo para el preview de la bandeja cuando el mensaje no trae
 * texto (una nota de voz, una foto). Sin esto la conversación decía "Sin
 * mensajes" aunque el mensaje estuviera ahí. Se guarda/emite en español;
 * `localizeContentToken` lo muestra en el idioma del usuario. Puro y
 * client-safe: lo usan el ingest (servidor) y el realtime de la bandeja.
 */
export function mediaPreviewToken(mime?: string | null): string {
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  if (!m) return "";
  if (m.startsWith("image/")) return "[Imagen]";
  if (m.startsWith("video/")) return "[Video]";
  if (m.startsWith("audio/")) return "[Audio]";
  return "[Documento]";
}

/** MercadoLibre sub-kind: a pre-sale QUESTION (public, shown on the listing)
 *  vs a post-sale MESSAGE (private, tied to an order pack). */
export type MlThreadKind = "question" | "message";

/**
 * Derive the ML sub-kind from a conversation's thread_external_id. ML encodes
 * it as a string prefix — `q:<id>` for questions, `pack:<id>` for post-sale
 * messages (see mercadolibre/adapter.ts). There is no typed column, so the UI
 * parses the prefix here, in ONE place, so the row badge, thread header and
 * sub-filter can't drift. Returns null for any non-ML conversation.
 */
export function mlThreadKind(
  channel: Channel,
  threadExternalId?: string | null,
): MlThreadKind | null {
  if (channel !== "mercadolibre" || !threadExternalId) return null;
  if (threadExternalId.startsWith("q:")) return "question";
  if (threadExternalId.startsWith("pack:")) return "message";
  return null;
}

import type { TFn } from "@/lib/i18n/translate";

/**
 * Locale-aware channel label for USER-FACING UI. Brand names (WhatsApp,
 * Instagram, Messenger, Gmail, Outlook) are returned as-is; only the
 * non-brand comment labels are translated. Backend/log uses can keep using
 * channelDisplay(channel).label directly.
 */
/** Marcadores que los adaptadores guardan como `content_text` cuando el
 *  mensaje no es texto (una imagen, una ubicación, un post compartido). Se
 *  persisten en un solo idioma — la UI los muestra en el del usuario. */
const CONTENT_TOKEN_KEYS: Record<string, string> = {
  "[imagen]": "inbox.previewImage",
  "[video]": "inbox.previewVideo",
  "[audio]": "inbox.previewAudio",
  "[documento]": "inbox.previewDocument",
  "[ubicación]": "inbox.previewLocation",
  "[sticker]": "inbox.previewSticker",
  "[contacto]": "inbox.previewContact",
  "[pedido]": "inbox.previewOrder",
  "[respuesta]": "inbox.previewButtonReply",
  "[respuesta interactiva]": "inbox.previewInteractive",
  "[mención en historia]": "inbox.previewStoryMention",
  "[publicación compartida]": "inbox.previewSharedPost",
  "[archivo no disponible]": "inbox.previewFileUnavailable",
};

/**
 * Traduce el marcador de tipo ("[Imagen]", "[Pedido]") al idioma activo.
 * También cuando encabeza un contenido con detalle debajo (el pedido lista sus
 * productos): sólo se traduce esa primera línea, el resto vuelve intacto.
 * Cualquier otro texto pasa sin tocar.
 */
export function localizeContentToken(
  text: string | null | undefined,
  t: TFn,
): string {
  const raw = (text ?? "").trim();
  if (!raw) return text ?? "";
  const exact = CONTENT_TOKEN_KEYS[raw.toLowerCase()];
  if (exact) return t(exact);
  const nl = raw.indexOf("\n");
  if (nl > 0) {
    const head = CONTENT_TOKEN_KEYS[raw.slice(0, nl).trim().toLowerCase()];
    if (head) return `${t(head)}${raw.slice(nl)}`;
  }
  return text ?? "";
}

export function channelLabel(channel: Channel, t: TFn): string {
  if (channel === "fb_comment") return t("common.channelFbComments");
  if (channel === "ig_comment") return t("common.channelIgComments");
  if (channel === "ml_review") return t("common.channelMlReviews");
  return CHANNEL_DISPLAY[channel].label;
}

/**
 * Quita las menciones que encabezan un comentario ("@usuario texto…").
 *
 * Instagram y Facebook anteponen el @ de la persona a toda respuesta dentro de
 * un hilo —es como notifican a quien comentó— y nuestro propio agente hace lo
 * mismo al contestar. En la bandeja ese @ no informa nada: el hilo ya muestra
 * de quién es cada burbuja y bajo qué comentario cuelga. Se saca sólo al
 * MOSTRAR; el texto guardado y el que sale publicado conservan la mención,
 * porque de ella depende que a la persona le llegue el aviso.
 *
 * Sólo al principio: un @ en medio de la frase es parte de lo que se dijo. Y
 * si el comentario era nada más que la mención, se devuelve intacto — antes
 * una burbuja vacía que una que miente.
 */
export function stripLeadingMentions(text: string | null | undefined): string {
  const raw = text ?? "";
  const rest = raw.replace(/^(?:@[A-Za-z0-9._]{1,30}[ \t]*)+/, "").trimStart();
  return rest || raw;
}
