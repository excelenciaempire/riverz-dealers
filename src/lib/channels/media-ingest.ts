/**
 * Media ingest — descarga el adjunto del canal y lo guarda en Supabase
 * Storage para que el resto del sistema lo trate como una URL estable.
 *
 * Por qué pasar por Storage:
 *   * Las URLs CDN de Meta para WhatsApp expiran a los pocos minutos y
 *     requieren Bearer auth (Claude no las puede bajar él solo).
 *   * Las URLs públicas de IG/Messenger también caducan tras unas horas.
 *   * El historial conversacional necesita poder mostrar el adjunto
 *     muchos días después.
 *
 * Bucket: "message-media", PRIVADO desde la migración 141, con las rutas
 * separadas por workspace_id/conversation_id. Lo que se guarda en la base es
 * `/api/media/<ruta>`; ver `media-url.ts` para el porqué y para las dos formas
 * de resolverla (bandeja con sesión, envío con firma).
 *
 * Es best-effort: si la descarga falla, devuelve null y el caller deja
 * el adjunto como texto plano "[Imagen]" como antes. Nunca tira excepción
 * — no queremos que un media corrupto bloquee la ingestión del mensaje.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "./encryption";
import { getMediaUrl } from "@/lib/whatsapp/meta-api";
import { downloadMedia } from "@/lib/whatsapp/media-download";
import { supabaseAdmin } from "./admin-client";
import { appMediaUrl, resolveMediaFetchUrl } from "./media-url";
import { appsecretProof } from "./meta-graph";
import { downloadPublicMedia } from '@/lib/security/download-public-media';

/** Tope de bytes por adjunto. El contenido lo controla el remitente del
 *  mensaje/email, así que sin un límite un archivo gigante bufferea RAM
 *  ilimitada en el worker (DoS de memoria). 25MB cubre los adjuntos reales
 *  de WhatsApp/Meta/email holgadamente. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Tope de adjuntos procesados por mensaje. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** Timeout de descarga de un adjunto remoto. */
const ATTACHMENT_FETCH_TIMEOUT_MS = 20_000;

/**
 * fetch con timeout (AbortController) y tope de bytes. Rechaza temprano por
 * Content-Length si el servidor lo declara, y si no, acumula por stream
 * abortando al cruzar el límite — así nunca bufferea más de MAX_ATTACHMENT_BYTES.
 * Devuelve null ante error, timeout o exceso de tamaño.
 */
async function fetchCapped(
  url: string,
  init?: RequestInit,
): Promise<{ buffer: Buffer; mime: string } | null> {
  return downloadPublicMedia(url, MAX_ATTACHMENT_BYTES, ATTACHMENT_FETCH_TIMEOUT_MS, init?.headers);
}

/**
 * Bytes de un adjunto YA re-hospedado (Supabase Storage) para volver a
 * enviarlo por un canal que no acepta una URL y quiere el archivo: Gmail y
 * Outlook lo mandan dentro del MIME, Mercado Libre lo sube antes por su
 * endpoint. Mismo tope y timeout que la ingesta. null si no se pudo bajar.
 *
 * La URL que llega es la de la app (`/api/media/…`), que exige cookie de
 * sesión y además es relativa: sin firmar antes, este fetch del servidor no
 * llega a ninguna parte.
 */
export async function fetchAttachmentBytes(
  url: string,
  workspaceId: string,
): Promise<{ buffer: Buffer; mime: string } | null> {
  return fetchCapped(await resolveMediaFetchUrl(url, workspaceId));
}

/** Nombre con el que viaja el archivo cuando el composer no mandó uno: el
 *  último segmento de la URL, o un genérico con la extensión del mime. */
export function attachmentFilename(url: string, mime: string): string {
  const fromUrl = url.split("?")[0].split("/").pop() ?? "";
  if (fromUrl.includes(".")) return fromUrl;
  return `adjunto.${mimeToExtension(mime)}`;
}

export type MediaCategory =
  | "image"
  | "voice"
  | "audio"
  | "video"
  | "document"
  | "sticker";

/** Content-Type que no dice nada: el CDN de Meta (y varias APIs) devuelven
 *  `application/octet-stream` para notas de voz y videos. Guardado así, la
 *  nota de voz entra como "documento" y la bandeja la muestra como enlace de
 *  descarga en vez de reproductor. Cuando el mime es genérico miramos los
 *  bytes. */
function isGenericMime(mime?: string | null): boolean {
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  return (
    !m ||
    // Algunos canales mandan una etiqueta ("photo", "file") en vez de un mime.
    !m.includes("/") ||
    m === "application/octet-stream" ||
    m === "binary/octet-stream" ||
    m === "application/binary" ||
    m === "application/download"
  );
}

/**
 * Detecta el tipo real por los primeros bytes del archivo (magic numbers).
 * Cubre lo que mandan los canales: notas de voz (ogg/opus, m4a/aac, mp3, amr,
 * wav, webm), fotos, video y PDF. Devuelve null si no reconoce la firma.
 */
export function sniffMime(buffer: Buffer, hint?: MediaCategory): string | null {
  if (buffer.length < 12) return null;
  const ascii = (start: number, len: number): string =>
    buffer.subarray(start, start + len).toString("latin1");
  const wantsAudio = hint === "audio" || hint === "voice";

  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (ascii(0, 5) === "#!AMR") return "audio/amr";
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  // MPEG audio frame sync (mp3 sin tag ID3).
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (ascii(0, 4) === "RIFF") {
    const kind = ascii(8, 4);
    if (kind === "WAVE") return "audio/wav";
    if (kind === "WEBP") return "image/webp";
    if (kind === "AVI ") return "video/x-msvideo";
  }
  // ISO-BMFF (mp4/m4a/mov). Instagram entrega las notas de voz acá: un mp4
  // con brand `isom` y SIN pista de video, que el CDN sirve como
  // `video/mp4` — guardado así, la nota de voz se ve como una burbuja de
  // video negra y muda. El contenedor lo dice: los `hdlr` declaran 'soun'
  // (audio) y 'vide' (video), así que preguntamos al archivo en vez de
  // confiar en el header o el brand.
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (brand.startsWith("qt")) return "video/quicktime";
    const tracks = isoTrackKinds(buffer);
    if (tracks.hasVideo) return "video/mp4";
    if (tracks.hasAudio) return "audio/mp4";
    if (brand.startsWith("M4A") || brand.startsWith("M4B")) return "audio/mp4";
    return wantsAudio ? "audio/mp4" : "video/mp4";
  }
  // Matroska / WebM.
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return wantsAudio ? "audio/webm" : "video/webm";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (ascii(1, 3) === "PNG") return "image/png";
  if (ascii(0, 3) === "GIF") return "image/gif";
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  return null;
}

/** Qué pistas declara un contenedor ISO-BMFF. Cada track trae un box `hdlr`
 *  con su tipo ('soun' | 'vide'); alcanza con buscarlos en la cabecera (el
 *  `moov` va al principio en lo que sirve Meta). Se mira sólo el primer MB
 *  para no recorrer un video largo entero. */
function isoTrackKinds(buffer: Buffer): { hasAudio: boolean; hasVideo: boolean } {
  const head = buffer.subarray(0, Math.min(buffer.length, 1024 * 1024)).toString("latin1");
  let hasAudio = false;
  let hasVideo = false;
  let i = head.indexOf("hdlr");
  while (i !== -1) {
    // Desde el nombre del box: 4 'hdlr' + 4 versión/flags + 4 pre_defined,
    // y ahí viene el handler_type ('soun' | 'vide').
    const handler = head.slice(i + 12, i + 16);
    if (handler === "soun") hasAudio = true;
    if (handler === "vide") hasVideo = true;
    i = head.indexOf("hdlr", i + 4);
  }
  return { hasAudio, hasVideo };
}

/**
 * Mime definitivo con el que se guarda el archivo. Manda el archivo, no el
 * header: el CDN de Meta sirve las notas de voz de Instagram como
 * `video/mp4` (un mp4 sin pista de video) y las de WhatsApp como
 * `application/octet-stream`. Con el header crudo la nota de voz entraba
 * como video mudo o como documento. Sólo se revisa el declarado cuando NO
 * es de fiar; un mime concreto y coherente se respeta tal cual.
 */
export function resolveMime(
  declared: string | null | undefined,
  buffer: Buffer,
  hint?: MediaCategory,
): string {
  const lower = (declared ?? "").toLowerCase().split(";")[0].trim();
  // mp4 declarado como video: puede ser una nota de voz. El contenedor decide.
  if (lower === "video/mp4" || lower === "application/mp4" || lower === "audio/mp4") {
    const tracks = isoTrackKinds(buffer);
    if (tracks.hasVideo) return "video/mp4";
    if (tracks.hasAudio) return "audio/mp4";
    return lower === "video/mp4" && hint !== "voice" && hint !== "audio"
      ? "video/mp4"
      : "audio/mp4";
  }
  if (!isGenericMime(declared)) return declared as string;
  const sniffed = sniffMime(buffer, hint);
  if (sniffed) return sniffed;
  if (hint === "voice" || hint === "audio") return "audio/mp4";
  if (hint === "image") return "image/jpeg";
  if (hint === "video") return "video/mp4";
  return declared || "application/octet-stream";
}

export interface IngestedMedia {
  /**
   * URL estable que se guarda en `messages.media_url`. Apunta a
   * `/api/media/<ruta>`, no a Storage: el bucket es privado y esa ruta es la
   * que comprueba la sesión antes de firmar.
   */
  url: string;
  /** Categoría normalizada para `messages.media_type`. */
  mediaType: MediaCategory;
  /** Content-Type real del archivo. */
  mediaMime: string;
  /** Bytes. */
  mediaSize: number;
  /** Filename original si lo dio el canal (documentos). */
  fileName?: string;
}

const BUCKET = "message-media";

/**
 * Descarga un media de WhatsApp (mediaId → CDN URL → bytes) y lo
 * persiste en Storage. Devuelve los metadatos para guardar en
 * `messages` o null si la descarga falló.
 */
export async function ingestWhatsappMedia(opts: {
  mediaId: string;
  /** Encrypted access_token tal como vive en channel_connections.secrets. */
  encryptedAccessToken: string;
  workspaceId: string;
  conversationId: string;
  hintedKind?: MediaCategory;
  fileName?: string;
}): Promise<IngestedMedia | null> {
  try {
    const accessToken = decrypt(opts.encryptedAccessToken);
    const { url, mimeType } = await getMediaUrl({
      mediaId: opts.mediaId,
      accessToken,
    });
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: url,
      accessToken,
    });
    // El mime declarado por Graph gana sobre el header del CDN: la CDN
    // lookaside devuelve "application/octet-stream" para muchas notas de
    // voz, y con eso la nota se guardaba como documento y se mostraba como
    // link de descarga en vez de reproductor. Solo caemos al header cuando
    // Graph no declara nada útil.
    const declared = mimeType && mimeType !== "application/octet-stream" ? mimeType : null;
    // Si ni Graph ni el CDN declaran algo útil, los bytes deciden — así una
    // nota de voz nunca queda como "documento".
    const mime = resolveMime(declared || contentType || mimeType, buffer, opts.hintedKind);
    const category = opts.hintedKind ?? mimeToCategory(mime);
    const ext = mimeToExtension(mime);
    const path = buildStoragePath(
      opts.workspaceId,
      opts.conversationId,
      opts.mediaId,
      ext,
    );
    const storedUrl = await uploadToStorage(path, buffer, mime);
    if (!storedUrl) return null;
    return {
      url: storedUrl,
      mediaType: category,
      mediaMime: mime,
      mediaSize: buffer.length,
      fileName: opts.fileName,
    };
  } catch (err) {
    console.warn("[media-ingest] whatsapp media failed:", err);
    return null;
  }
}

/**
 * Descarga un adjunto IG/Messenger desde la URL pública que viene en el
 * payload del webhook (no requiere token). Lo persiste en Storage.
 */
export async function ingestMetaAttachment(opts: {
  attachmentUrl: string;
  workspaceId: string;
  conversationId: string;
  externalMessageId?: string;
  hintedKind?: MediaCategory;
  /** Page token de la conexión. Algunos assets del CDN de Meta (típicamente
   *  el audio de `lookaside.fbsbx.com/ig_messaging_cdn`) responden 403 sin
   *  credencial; sólo se reintenta con token cuando la baja anónima falla. */
  accessToken?: string;
  /** `mid` del mensaje de Messenger/Instagram y posición del adjunto en él.
   *  Con los dos y el token, cuando la URL del webhook no sirve se le pide a
   *  Graph una fresca (ver `refetchMetaAttachmentUrl`). */
  mid?: string;
  attachmentIndex?: number;
}): Promise<IngestedMedia | null> {
  try {
    // LA URL DEL WEBHOOK PUEDE DEVOLVER UNA PÁGINA, NO EL ARCHIVO.
    //
    // El 2026-09-15 el CDN de Instagram (`lookaside.fbsbx.com/ig_messaging_cdn`)
    // respondió 200 con un HTML de Facebook de ~48 KB para TODAS las fotos
    // que mandaron los clientes de un comercio: comprobantes de pago,
    // capturas de un anuncio, una mención en historia. Con el 200 nadie
    // reintentaba: el HTML se guardaba como `.bin`, la bandeja lo mostraba
    // como "Archivo" y la IA le decía a la clienta que su comprobante "no
    // llegó" mientras ella lo mandaba por tercera vez. El mismo `mid`,
    // preguntado a Graph, devolvía una URL nueva que sí bajaba el JPEG.
    //
    // Así que un HTML nunca es un adjunto: se tira y se pasa al siguiente
    // camino —con token, y después Graph por `mid`—. Si ninguno da un
    // archivo real, se devuelve null y el mensaje queda como no disponible,
    // que al menos es verdad.
    const fetched =
      esArchivoReal(await fetchCapped(opts.attachmentUrl)) ??
      esArchivoReal(
        await fetchMetaCdnAuthenticated(opts.attachmentUrl, opts.accessToken),
      ) ??
      (await fetchViaGraph(opts));
    if (!fetched) return null;
    const { buffer } = fetched;
    const mime = resolveMime(fetched.mime, buffer, opts.hintedKind);
    const category = opts.hintedKind ?? mimeToCategory(mime);
    const ext = mimeToExtension(mime);
    const id =
      opts.externalMessageId || `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = buildStoragePath(
      opts.workspaceId,
      opts.conversationId,
      id,
      ext,
    );
    const storedUrl = await uploadToStorage(path, buffer, mime);
    if (!storedUrl) return null;
    return {
      url: storedUrl,
      mediaType: category,
      mediaMime: mime,
      mediaSize: buffer.length,
    };
  } catch (err) {
    console.warn("[media-ingest] meta attachment failed:", err);
    return null;
  }
}

/** Reintento autenticado de un asset del CDN de Meta: primero con el token
 *  como Bearer, luego como parámetro `access_token` (Meta acepta las dos
 *  formas según el endpoint). Sólo para hosts de Meta — jamás mandamos el
 *  token del comercio a un tercero. */
async function fetchMetaCdnAuthenticated(
  url: string,
  accessToken?: string,
): Promise<{ buffer: Buffer; mime: string } | null> {
  if (!accessToken) return null;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const isMeta = [
    "fbcdn.net",
    "cdninstagram.com",
    "fbsbx.com",
    "akamaihd.net",
    "facebook.com",
    "instagram.com",
  ].some((h) => host === h || host.endsWith(`.${h}`));
  if (!isMeta) return null;

  const withBearer = await fetchCapped(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (withBearer) return withBearer;
  try {
    const u = new URL(url);
    u.searchParams.set("access_token", accessToken);
    return await fetchCapped(u.toString());
  } catch {
    return null;
  }
}

/** Una respuesta que es una página web no es un adjunto: el CDN de Meta
 *  contesta 200 con HTML cuando la URL firmada no le sirve (ver
 *  `ingestMetaAttachment`). Se mira el Content-Type y, por si viene como
 *  octet-stream, también los primeros bytes. */
export function esArchivoReal(
  fetched: { buffer: Buffer; mime: string } | null,
): { buffer: Buffer; mime: string } | null {
  if (!fetched) return null;
  const mime = fetched.mime.toLowerCase().split(";")[0].trim();
  if (mime === "text/html" || mime === "application/xhtml+xml") return null;
  const head = fetched.buffer
    .subarray(0, 512)
    .toString("latin1")
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return null;
  return fetched;
}

/**
 * Graph conoce el adjunto por el `mid` aunque la URL del webhook ya no
 * sirva: `GET /{mid}?fields=attachments{image_data,video_data,file_url}`
 * devuelve una URL firmada nueva. Se pide sólo cuando las otras dos
 * descargas no dieron un archivo real; sin `mid` o sin token no hay nada
 * que pedir.
 */
async function fetchViaGraph(opts: {
  mid?: string;
  attachmentIndex?: number;
  accessToken?: string;
}): Promise<{ buffer: Buffer; mime: string } | null> {
  const fresh = await refetchMetaAttachmentUrl(opts);
  if (!fresh) return null;
  return (
    esArchivoReal(await fetchCapped(fresh)) ??
    esArchivoReal(await fetchMetaCdnAuthenticated(fresh, opts.accessToken))
  );
}

/** URL fresca del adjunto número `attachmentIndex` del mensaje `mid`, o null. */
export async function refetchMetaAttachmentUrl(opts: {
  mid?: string;
  attachmentIndex?: number;
  accessToken?: string;
}): Promise<string | null> {
  if (!opts.mid || !opts.accessToken) return null;
  try {
    const url = new URL(`https://graph.facebook.com/v22.0/${encodeURIComponent(opts.mid)}`);
    url.searchParams.set("fields", "attachments{image_data,video_data,file_url}");
    url.searchParams.set("access_token", opts.accessToken);
    const proof = appsecretProof(opts.accessToken);
    if (proof) url.searchParams.set("appsecret_proof", proof);
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      attachments?: { data?: Array<Record<string, unknown>> };
    };
    const list = json.attachments?.data ?? [];
    const a = (list[opts.attachmentIndex ?? 0] ?? list[0] ?? {}) as Record<string, unknown>;
    const image = (a.image_data ?? {}) as { url?: unknown };
    const video = (a.video_data ?? {}) as { url?: unknown };
    const candidate = [image.url, video.url, a.file_url].find(
      (v) => typeof v === "string" && v.trim(),
    );
    return typeof candidate === "string" ? candidate.trim() : null;
  } catch (err) {
    console.warn("[media-ingest] graph refetch failed:", err);
    return null;
  }
}

/**
 * Persist already-downloaded bytes (email attachments — Gmail returns
 * base64url via attachments.get, Graph returns base64 contentBytes) to
 * Storage. Same contract as the other ingesters: returns the public URL
 * metadata or null on failure, never throws.
 */
export async function ingestRawMedia(opts: {
  buffer: Buffer;
  mime: string;
  workspaceId: string;
  conversationId: string;
  id: string;
  fileName?: string;
  hintedKind?: MediaCategory;
}): Promise<IngestedMedia | null> {
  try {
    // Red de seguridad común a Gmail/Outlook: nunca persistir un adjunto
    // que exceda el tope (los callers ya filtran por tamaño declarado).
    if (opts.buffer.length > MAX_ATTACHMENT_BYTES) return null;
    // Gmail/Outlook/Mercado Libre declaran a veces octet-stream: los bytes
    // mandan, para que una nota de voz adjunta se reproduzca igual.
    const mime = resolveMime(opts.mime, opts.buffer, opts.hintedKind);
    const category = opts.hintedKind ?? mimeToCategory(mime);
    // Prefer the real filename's extension (preserves .pdf/.docx names);
    // fall back to the mime map.
    const nameExt =
      opts.fileName && opts.fileName.includes(".")
        ? opts.fileName.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "")
        : "";
    const ext = nameExt || mimeToExtension(mime);
    const path = buildStoragePath(
      opts.workspaceId,
      opts.conversationId,
      opts.id,
      ext,
    );
    const storedUrl = await uploadToStorage(path, opts.buffer, mime);
    if (!storedUrl) return null;
    return {
      url: storedUrl,
      mediaType: category,
      mediaMime: mime,
      mediaSize: opts.buffer.length,
      fileName: opts.fileName,
    };
  } catch (err) {
    console.warn("[media-ingest] raw media failed:", err);
    return null;
  }
}

/**
 * Sube el archivo y devuelve la URL que se guarda en la base: la de la app,
 * no la de Storage. El bucket es privado, así que una URL directa no serviría
 * a nadie sin firma — y una firma guardada caducaría dentro del mensaje.
 */
async function uploadToStorage(
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<string | null> {
  const db: SupabaseClient = supabaseAdmin();
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: true,
      cacheControl: "31536000",
    });
  if (error) {
    console.warn("[media-ingest] upload failed:", error.message);
    return null;
  }
  return appMediaUrl(path);
}

function buildStoragePath(
  workspaceId: string,
  conversationId: string,
  id: string,
  ext: string,
): string {
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${workspaceId}/${conversationId}/${safeId}.${ext}`;
}

/**
 * Mapea un MIME real al tipo discreto que guardamos en
 * `messages.media_type`. Heurística simple y conservadora — si no
 * matchea ninguno, cae a "document".
 */
export function mimeToCategory(mime: string): MediaCategory {
  const lower = mime.toLowerCase().split(";")[0].trim();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("video/")) return "video";
  // WhatsApp voice notes vienen como audio/ogg con codec opus.
  if (lower === "audio/ogg" || lower === "audio/amr" || lower === "audio/opus") {
    return "voice";
  }
  if (lower.startsWith("audio/")) return "audio";
  return "document";
}

function mimeToExtension(mime: string): string {
  const lower = mime.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/3gpp": "3gp",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/amr": "amr",
    "audio/3gpp": "3ga",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
    "audio/webm": "weba",
    "video/x-msvideo": "avi",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "text/plain": "txt",
  };
  return map[lower] ?? "bin";
}
