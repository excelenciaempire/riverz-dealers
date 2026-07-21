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
    const mime = declared || contentType || mimeType || "application/octet-stream";
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
}): Promise<IngestedMedia | null> {
  try {
    const fetched = await fetchCapped(opts.attachmentUrl);
    if (!fetched) return null;
    const { buffer, mime } = fetched;
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
    const mime = opts.mime || "application/octet-stream";
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
  const lower = mime.toLowerCase();
  if (lower.startsWith("image/")) return "image";
  if (lower.startsWith("video/")) return "video";
  // WhatsApp voice notes vienen como audio/ogg con codec opus.
  if (lower === "audio/ogg" || lower === "audio/amr") return "voice";
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
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/amr": "amr",
    "audio/wav": "wav",
    "audio/webm": "weba",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "text/plain": "txt",
  };
  return map[lower] ?? "bin";
}
