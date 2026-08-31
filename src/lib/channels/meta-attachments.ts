import type { MessageAttachment } from "@/types";
import { ingestMetaAttachment } from "./media-ingest";

/**
 * Traductor único de `message.attachments` de Meta (Messenger + Instagram DM)
 * a lo que la bandeja sabe mostrar.
 *
 * Antes sólo se bajaban image/video/audio/file y TODO lo demás se descartaba
 * en silencio: un enlace compartido, una tarjeta de producto, una mención en
 * historia o una ubicación entraban como mensaje con texto vacío y en la
 * bandeja quedaba una burbuja en blanco — la conversación no se veía completa.
 * Acá cada adjunto termina en una de dos cosas:
 *   - `media`: archivo re-hospedado en Storage (permalink propio, las URL del
 *     CDN de Meta caducan en horas).
 *   - `descriptions`: una línea legible (título + enlace) que se concatena al
 *     texto del mensaje, así la burbuja y el preview de la lista siempre dicen
 *     algo.
 */
export interface MetaAttachmentsResult {
  media: MessageAttachment[];
  descriptions: string[];
  /**
   * Meta anunció un adjunto y no mandó con qué mostrarlo.
   *
   * El caso real es `type: "ephemeral"`: el ver-una-vez y el modo temporal de
   * Instagram. El webhook trae el tipo y NADA más —ni `payload`, ni URL— y la
   * Conversations API tampoco lo tiene: verificado el 2026-08-30 pidiendo ese
   * mismo `mid` a Graph, que devolvió 200 con `message: ""` y sin la arista
   * `attachments`. No hay nada que bajar, ni ahora ni después.
   *
   * Se distingue del "no quedó nada que mostrar" genérico para que la burbuja
   * diga qué pasó y el agente no lo confunda con un archivo roto.
   */
  unsupported: boolean;
}

/** Adjuntos que SON un archivo descargable del CDN de Meta. `story_mention` y
 *  los reels/posts compartidos de IG también lo son: el `type` no dice si es
 *  foto o video, lo decide el mime real.
 *
 *  `sticker` entró el 2026-08-30 por un cambio de Meta con fecha:
 *
 *    "Sticker messages in webhooks now include a new `sticker` attachment type
 *     with `sticker_id` metadata. During the 90-day transition period, both the
 *     `sticker` and `image` attachment types are present in the payload. After
 *     August 30, 2026, only the `sticker` attachment type will be sent."
 *    — developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages
 *
 *  Sin él, desde esa fecha un sticker de Messenger caía al `else` del final y
 *  quedaba rotulado "[Publicación compartida]". Instagram no se ve afectado:
 *  ahí los stickers directamente no disparan webhook. */
const MEDIA_TYPES = new Set([
  "image",
  "video",
  "audio",
  "file",
  "sticker",
  "story_mention",
  "ig_reel",
  "reel",
]);

/** Marcadores entre corchetes: la burbuja los oculta cuando ya se ve el archivo
 *  (isTypePlaceholder) y el preview de la lista los muestra localizados. */
export const STORY_MENTION_LABEL = "[Mención en historia]";
export const SHARED_POST_LABEL = "[Publicación compartida]";
const LOCATION_LABEL = "[Ubicación]";
const MEDIA_UNAVAILABLE_LABEL = "[Archivo no disponible]";
/** Sentinela que `isUnsupportedSnippet` ya reconoce y la UI localiza. */
export const META_UNSUPPORTED_LABEL = "[unsupported]";
/** Meta avisa `is_unsupported: true` cuando la plataforma NO entrega el
 *  contenido: notas de voz de Instagram, GIFs, y contenido compartido de
 *  cuentas privadas llegan así — sin adjunto ni texto, ni siquiera vía Graph.
 *  Se distingue del sentinela genérico para que la burbuja explique que el
 *  mensaje existe y hay que abrirlo en la app, en vez de un "[No compatible]"
 *  mudo. */
export const META_UNSUPPORTED_MEDIA_LABEL = "[unsupported media]";

/** True cuando el texto compuesto es uno de los dos sentinelas — o sea, el
 *  mensaje entró sin nada que mostrar. */
export function isMetaUnsupportedText(text: string): boolean {
  return text === META_UNSUPPORTED_LABEL || text === META_UNSUPPORTED_MEDIA_LABEL;
}

/**
 * El mensaje es SÓLO una mención en historia o una publicación compartida: no
 * hay pregunta que contestar, y por eso el despacho de Instagram lo deja pasar
 * sin molestar al agente.
 *
 * Se compara contra los dos rótulos exactos a propósito. Antes esto era un
 * regex de forma —`/^\[[^\]]+\]$/`, "cualquier cosa entre corchetes"— y se
 * comía además los dos sentinelas de "no nos llegó", `[Ubicación]` y
 * `[Archivo no disponible]`. Un mensaje que el agente TIENE que ver quedaba sin
 * turno: ni respuesta, ni fila en `ai_replies`, ni escalada. Verificado el
 * 2026-08-30 en la cuenta Pilar: seis mensajes de Instagram, invisibles.
 *
 * Se mira línea por línea porque dos adjuntos de vitrina en el mismo DM llegan
 * como dos rótulos separados por un salto.
 */
const SOLO_VITRINA = new Set(
  [STORY_MENTION_LABEL, SHARED_POST_LABEL].map((l) => l.toLowerCase()),
);

export function isStoryMentionOrShareOnly(text?: string | null): boolean {
  const lineas = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lineas.length > 0 && lineas.every((l) => SOLO_VITRINA.has(l.toLowerCase()));
}

/**
 * Deja en el log EXACTAMENTE lo que mandó Meta cuando un mensaje entrante no
 * dejó ni texto ni archivo. Es el único caso donde la bandeja no puede mostrar
 * el contenido, y sin el payload no se distingue "Meta no lo entregó" de "el
 * adjunto venía con una forma que no leemos". El mensaje no tiene texto por
 * definición en esta rama: sólo se loguean ids y metadatos del adjunto.
 */
export function logUnrenderableMetaMessage(channel: string, message: unknown): void {
  try {
    console.warn(
      `[${channel}] mensaje entrante sin contenido renderable — payload:`,
      JSON.stringify(message).slice(0, 1200),
    );
  } catch {
    /* nunca romper la ingesta por un log */
  }
}

/** Desenvuelve el redirector de Meta (`l.facebook.com/l.php?u=…`) para guardar
 *  el enlace real que el cliente compartió. */
export function unwrapMetaLink(raw: string): string {
  try {
    const u = new URL(raw);
    if (/^(l|lm|lt)\.(facebook|instagram)\.com$/i.test(u.hostname) && u.pathname === "/l.php") {
      const target = u.searchParams.get("u");
      if (target) return target;
    }
    return raw;
  } catch {
    return raw;
  }
}

/** ¿La URL es de un CDN de Meta? Sólo bajamos a Storage lo que sirve Meta —
 *  nunca salimos a buscar un sitio de terceros por un enlace de un webhook. */
function isMetaCdn(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h.endsWith("fbcdn.net") ||
      h.endsWith("cdninstagram.com") ||
      h.endsWith("fbsbx.com") ||
      h.endsWith("akamaihd.net")
    );
  } catch {
    return false;
  }
}

function str(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** "Título\nenlace" — sin repetir cuando el título ES el enlace. */
function describeLink(title: string, url: string): string {
  if (title && url) return title === url ? url : `${title}\n${url}`;
  return title || url || "";
}

function hintFor(type: string): "image" | "video" | "audio" | "document" | undefined {
  if (type === "image" || type === "sticker") return "image";
  if (type === "video") return "video";
  if (type === "audio") return "audio";
  if (type === "file") return "document";
  return undefined;
}

export async function ingestMetaAttachments(input: {
  attachments?: Array<Record<string, unknown>>;
  workspaceId: string;
  /** PSID / IGSID — path estable en Storage (la conversación se crea después). */
  externalContactId: string;
  externalMessageId?: string;
  /** Page token: sólo se usa para reintentar un asset del CDN de Meta que
   *  rechaza la descarga anónima (pasa con el audio de las notas de voz). */
  accessToken?: string;
}): Promise<MetaAttachmentsResult> {
  const list = Array.isArray(input.attachments) ? input.attachments : [];
  const media: MessageAttachment[] = [];
  const descriptions: string[] = [];
  /**
   * El mismo archivo, anunciado dos veces en el mismo mensaje, se baja UNA.
   *
   * Meta lo hace a propósito durante las transiciones: en la del sticker manda
   * el adjunto `image` y el `sticker` apuntando a la misma URL, para que los
   * que ya leían `image` no se rompan. Sin este freno, el sticker entraba dos
   * veces a Storage y salían dos burbujas idénticas.
   */
  const yaBajadas = new Set<string>();
  let unsupported = false;
  let slot = 0;

  /** Baja el archivo a Storage. `requireMedia` descarta lo que resulte no ser
   *  imagen/video/audio (un enlace del CDN que devuelve HTML, por ejemplo). */
  const download = async (
    url: string,
    hinted?: "image" | "video" | "audio" | "document",
    requireMedia = false,
  ): Promise<boolean> => {
    // Ya vino en otro adjunto de ESTE mismo mensaje: se da por bajada, así el
    // duplicado no deja rótulo ni segunda burbuja.
    if (yaBajadas.has(url)) return true;
    yaBajadas.add(url);
    const ingested = await ingestMetaAttachment({
      attachmentUrl: url,
      workspaceId: input.workspaceId,
      conversationId: input.externalContactId,
      externalMessageId: input.externalMessageId
        ? `${input.externalMessageId}-${slot}`
        : undefined,
      hintedKind: hinted,
      accessToken: input.accessToken,
    });
    slot++;
    if (!ingested) return false;
    if (requireMedia && !/^(image|video|audio)\//i.test(ingested.mediaMime)) {
      return false;
    }
    media.push({
      url: ingested.url,
      mime_type: ingested.mediaMime,
      size: ingested.mediaSize,
    });
    return true;
  };

  for (const raw of list) {
    const a = (raw ?? {}) as Record<string, unknown>;
    const type = String(a.type ?? "").toLowerCase();
    const payload = (a.payload ?? {}) as Record<string, unknown>;
    const url = str(payload.url);
    const title = str(a.title, payload.title);

    // Ver-una-vez de Instagram. Meta manda `{type:"ephemeral"}` pelado y lo
    // documenta así, con esas palabras:
    //
    //   `"type":"ephemeral" // no URL is included for ephemeral media`
    //   "Disappearing media (view once, allow replay) is not supported on
    //    Instagram media webhooks."
    //   — developers.facebook.com/docs/messenger-platform/instagram/features/webhook
    //
    // No es un permiso que falte ni un campo que no estemos pidiendo: pedirle
    // ese `mid` a Graph con `fields=attachments{image_data,video_data,file_url}`
    // devuelve 200 y el id pelado, mientras que una imagen normal de la MISMA
    // cuenta y con la MISMA consulta devuelve `image_data.url` y baja (probado
    // el 2026-08-30, 16 días después del mensaje). No hay nada que rescatar.
    //
    // Sin este caso caía al `else` del final y salía como el sentinela
    // genérico, que se lee como un error nuestro.
    if (type === "ephemeral") {
      unsupported = true;
      continue;
    }

    if (MEDIA_TYPES.has(type)) {
      if (url && (await download(url, hintFor(type)))) {
        if (type === "story_mention") descriptions.push(STORY_MENTION_LABEL);
        continue;
      }
      // La descarga falló (URL caducada, 404, archivo > tope): al menos dejamos
      // el enlace o un rótulo para que el mensaje no se vea vacío.
      descriptions.push(describeLink(title, url) || MEDIA_UNAVAILABLE_LABEL);
      continue;
    }

    if (type === "location") {
      const coords = (payload.coordinates ?? {}) as { lat?: unknown; long?: unknown };
      const lat = Number(coords.lat);
      const lng = Number(coords.long);
      descriptions.push(
        Number.isFinite(lat) && Number.isFinite(lng)
          ? `${title || LOCATION_LABEL}\nhttps://maps.google.com/?q=${lat},${lng}`
          : title || LOCATION_LABEL,
      );
      continue;
    }

    // Plantilla genérica: las tarjetas de producto/enlace que Meta arma con
    // `elements[]` (título, subtítulo, imagen y enlace). Es lo que se ve en el
    // chat como una tarjeta con foto — la bajamos y describimos.
    const elements = Array.isArray(payload.elements)
      ? (payload.elements as Array<Record<string, unknown>>)
      : [];
    if (elements.length > 0) {
      for (const rawEl of elements) {
        const el = (rawEl ?? {}) as Record<string, unknown>;
        const action = (el.default_action ?? {}) as Record<string, unknown>;
        const image = str(el.image_url);
        if (image) await download(image, "image");
        const line = describeLink(
          str(el.title, el.subtitle),
          unwrapMetaLink(str(action.url, el.item_url, el.url)),
        );
        if (line) descriptions.push(line);
      }
      if (descriptions.length === 0 && title) descriptions.push(title);
      continue;
    }

    // share / fallback / cualquier tipo nuevo de Meta = algo compartido.
    // Instagram entrega los posts y reels compartidos como archivo del CDN;
    // Messenger entrega los enlaces como `fallback` con la URL real.
    const link = url ? unwrapMetaLink(url) : "";
    if (link && isMetaCdn(link) && (await download(link, undefined, true))) {
      descriptions.push(title || SHARED_POST_LABEL);
      continue;
    }
    descriptions.push(describeLink(title, link) || META_UNSUPPORTED_LABEL);
  }

  return { media, descriptions, unsupported };
}

/**
 * Texto final del mensaje: lo que escribió la persona + la descripción de lo
 * que compartió, sin repetir líneas. Cuando no queda nada que mostrar y
 * tampoco hay archivo, devolvemos el sentinela de "no compatible" para que la
 * bandeja muestre un rótulo en vez de una burbuja en blanco.
 */
export function composeMetaText(
  text: string | undefined,
  descriptions: string[],
  hasMedia: boolean,
  /** `message.is_unsupported` del webhook: Meta retuvo el contenido. */
  unsupportedMedia = false,
): string {
  const parts = [String(text ?? "").trim(), ...descriptions.map((d) => d.trim())].filter(
    Boolean,
  );
  const joined = [...new Set(parts)].join("\n");
  if (joined) return joined;
  if (hasMedia) return "";
  return unsupportedMedia ? META_UNSUPPORTED_MEDIA_LABEL : META_UNSUPPORTED_LABEL;
}
