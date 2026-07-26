/**
 * Media ingest — descarga el adjunto del canal y lo guarda en Supabase
 * Storage para que el resto del sistema lo trate como una URL pública
 * estable.
 *
 * Por qué pasar por Storage:
 *   * Las URLs CDN de Meta para WhatsApp expiran a los pocos minutos y
 *     requieren Bearer auth (Claude no las puede bajar él solo).
 *   * Las URLs públicas de IG/Messenger también caducan tras unas horas.
 *   * El historial conversacional necesita poder mostrar el adjunto
 *     muchos días después.
 *
 * Bucket: "message-media", público, scoped por workspace_id/conversation_id.
 *
 * Es best-effort: si la descarga falla, devuelve null y el caller deja
 * el adjunto como texto plano "[Imagen]" como antes. Nunca tira excepción
 * — no queremos que un media corrupto bloquee la ingestión del mensaje.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "./encryption";
import { getMediaUrl, downloadMedia } from "@/lib/whatsapp/meta-api";
import { supabaseAdmin } from "./admin-client";

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTACHMENT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") || "application/octet-stream";
    const declared = Number(res.headers.get("content-length") || "0");
    if (declared && declared > MAX_ATTACHMENT_BYTES) return null;
    if (!res.body) {
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > MAX_ATTACHMENT_BYTES ? null : { buffer: buf, mime };
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_ATTACHMENT_BYTES) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
    }
    return { buffer: Buffer.concat(chunks), mime };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  // ISO-BMFF: el brand del `ftyp` distingue audio (M4A) de video (mp4/mov).
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (brand.startsWith("M4A") || brand.startsWith("M4B")) return "audio/mp4";
    if (brand.startsWith("qt")) return "video/quicktime";
    // IG/Messenger sirven las notas de voz como mp4 con brand isom/mp42: el
    // hint del adjunto es lo único que distingue audio de video ahí.
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

/**
 * Mime definitivo con el que se guarda el archivo: el declarado si sirve,
 * si no lo que dicen los bytes, y como último recurso el que sugiere el tipo
 * de adjunto que anunció el canal. Nunca deja un audio como octet-stream.
 */
export function resolveMime(
  declared: string | null | undefined,
  buffer: Buffer,
  hint?: MediaCategory,
): string {
  if (!isGenericMime(declared)) return declared as string;
  const sniffed = sniffMime(buffer, hint);
  if (sniffed) return sniffed;
  if (hint === "voice" || hint === "audio") return "audio/mp4";
  if (hint === "image") return "image/jpeg";
  if (hint === "video") return "video/mp4";
  return declared || "application/octet-stream";
}

export interface IngestedMedia {
  /** URL pública en Supabase Storage. */
  publicUrl: string;
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
    const publicUrl = await uploadToStorage(path, buffer, mime);
    if (!publicUrl) return null;
    return {
      publicUrl,
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
}): Promise<IngestedMedia | null> {
  try {
    const fetched =
      (await fetchCapped(opts.attachmentUrl)) ??
      (await fetchMetaCdnAuthenticated(opts.attachmentUrl, opts.accessToken));
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
    const publicUrl = await uploadToStorage(path, buffer, mime);
    if (!publicUrl) return null;
    return {
      publicUrl,
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
    const publicUrl = await uploadToStorage(path, opts.buffer, mime);
    if (!publicUrl) return null;
    return {
      publicUrl,
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
  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
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
