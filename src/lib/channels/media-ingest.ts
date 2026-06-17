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
    const mime = contentType || mimeType || "application/octet-stream";
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
    const res = await fetch(opts.attachmentUrl);
    if (!res.ok) return null;
    const mime =
      res.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
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
