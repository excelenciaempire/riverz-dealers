import { createHash } from "crypto";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/channels/admin-client";

/**
 * Compatibilidad de imágenes salientes con WhatsApp Cloud API.
 *
 * Por qué existe: WhatsApp solo acepta **JPEG y PNG** en mensajes de tipo
 * `image`. Un `.webp` (lo que sirve Shopify por defecto y lo que exporta media
 * herramienta de diseño) se envía bien a Meta y **falla en la entrega** con el
 * código 131053 — `"WebP image uploads are not currently supported."`. Lo mismo
 * pasa con HEIC/HEIF (fotos de iPhone), AVIF, GIF, BMP y TIFF.
 *
 * Solución: convertir a JPEG antes de enviar. Dos puntos de entrada:
 *  - `toSendableImage` — al subir un adjunto desde el composer (se guarda ya
 *    convertido, así la miniatura del hilo y lo que ve el cliente coinciden).
 *  - `ensureSendableImageUrl` — red de seguridad en el envío, para URLs que no
 *    pasaron por el composer (imágenes de producto, nodos de flujo, Shopify).
 *
 * Todo es **fail-soft**: si algo sale mal se devuelve el original y el envío
 * sigue su curso — nunca peor que antes del arreglo.
 *
 * Referencia: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media#supported-media-types
 */

/** Los únicos mimes que WhatsApp acepta en un mensaje `image`. */
const SENDABLE_IMAGE_MIMES = new Set(["image/jpeg", "image/png"]);

/** Tope de Meta para imágenes (5 MB). Dejamos margen para el re-encode. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Lado máximo tras la conversión: WhatsApp reescala igual del lado del cliente. */
const MAX_DIMENSION = 2400;

const BUCKET = "message-media";

export function isSendableImageMime(mime: string | null | undefined): boolean {
  return SENDABLE_IMAGE_MIMES.has((mime ?? "").toLowerCase().split(";")[0].trim());
}

/** Mime declarado que amerita mirar los bytes (imagen o genérico). */
function looksLikeImage(mime: string | null | undefined): boolean {
  const lower = (mime ?? "").toLowerCase().split(";")[0].trim();
  return (
    lower.startsWith("image/") ||
    lower === "application/octet-stream" ||
    lower === "binary/octet-stream" ||
    lower === ""
  );
}

export interface SendableImage {
  buffer: Buffer;
  mime: string;
  /** true si hubo transcodificación (el llamador debe renombrar a .jpg). */
  converted: boolean;
}

/**
 * Devuelve una versión enviable del buffer. No confía en el mime declarado:
 * decide con el formato real que lee sharp, así una foto renombrada a `.jpg`
 * pero que en realidad es WebP tampoco rompe. Si no es una imagen (video, PDF)
 * se devuelve intacta.
 */
export async function toSendableImage(
  buffer: Buffer,
  declaredMime: string | null | undefined,
): Promise<SendableImage> {
  const unchanged: SendableImage = {
    buffer,
    mime: declaredMime || "application/octet-stream",
    converted: false,
  };
  if (!looksLikeImage(declaredMime)) return unchanged;

  try {
    const meta = await sharp(buffer).metadata();
    const format = meta.format; // 'webp' | 'heif' | 'jpeg' | 'png' | 'gif' | ...
    if (!format) return unchanged;
    const realMime = format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : null;
    // Ya es enviable: solo corregimos el mime si venía mal declarado.
    if (realMime) {
      return { buffer, mime: realMime, converted: false };
    }
    // GIF animado → primer frame. Perder la animación es mejor que no entregar:
    // WhatsApp tampoco acepta GIF como `image` (iría como video o sticker).
    const jpeg = await sharp(buffer)
      .rotate() // respeta la orientación EXIF antes de tirar los metadatos
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    if (jpeg.length > MAX_IMAGE_BYTES) {
      const smaller = await sharp(buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer();
      if (smaller.length <= MAX_IMAGE_BYTES) {
        return { buffer: smaller, mime: "image/jpeg", converted: true };
      }
    }
    return { buffer: jpeg, mime: "image/jpeg", converted: true };
  } catch {
    // No es una imagen que sharp entienda: que siga el camino normal.
    return unchanged;
  }
}

/** Cambia la extensión del nombre de archivo a .jpg conservando el resto. */
export function toJpegFileName(name: string | undefined): string | undefined {
  if (!name) return name;
  return name.includes(".") ? `${name.replace(/\.[^.]+$/, "")}.jpg` : `${name}.jpg`;
}

/**
 * Red de seguridad en el envío: si la URL apunta a un formato que WhatsApp no
 * acepta, la descarga, la convierte a JPEG, la sube a Storage y devuelve la
 * nueva URL pública. Si ya es JPEG/PNG (o falla cualquier paso) devuelve la URL
 * original sin tocar nada.
 *
 * El objeto convertido se cachea por hash de la URL, así una misma imagen de
 * producto se transcodifica una sola vez.
 */
export async function ensureSendableImageUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const declared = res.headers.get("content-type");
    const buffer = Buffer.from(await res.arrayBuffer());
    const safe = await toSendableImage(buffer, declared);
    if (!safe.converted) return url;

    const key = createHash("sha1").update(url).digest("hex");
    const path = `transcoded/${key}.jpg`;
    const db = supabaseAdmin();
    const { error } = await db.storage.from(BUCKET).upload(path, safe.buffer, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "31536000",
    });
    if (error) {
      console.warn("[image-compat] transcode upload failed:", error.message);
      return url;
    }
    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl || url;
  } catch (err) {
    console.warn("[image-compat] transcode skipped:", err);
    return url;
  }
}
