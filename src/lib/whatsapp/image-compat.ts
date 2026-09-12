import { createHash } from "crypto";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { downloadPublicMedia } from '@/lib/security/download-public-media';
import {
  OUTBOUND_SIGNED_TTL_SECONDS,
  resolveMediaFetchUrl,
  signMediaPath,
  storagePathFromUrl,
} from "@/lib/channels/media-url";

/**
 * Compatibilidad de imágenes salientes con WhatsApp Cloud API.
 *
 * Por qué existe: WhatsApp solo acepta **JPEG y PNG, RGB/RGBA de 8 bits por
 * canal y hasta 5 MB** en mensajes de tipo `image`. Un `.webp` (lo que sirve
 * Shopify por defecto y lo que exporta media herramienta de diseño) se envía
 * bien a Meta y **falla en la entrega** con el código 131053 — `"WebP image
 * uploads are not currently supported."`. Lo mismo pasa con HEIC/HEIF, AVIF,
 * GIF, BMP y TIFF, y también con un PNG que *parece* válido: una captura de
 * iPhone viene en 16 bits por canal y Meta la rechaza con `"Image is invalid.
 * Please check the image properties…"`.
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
    // Ser JPEG o PNG no alcanza. Meta pide además 8 bit por canal y RGB/RGBA:
    // una captura de iPhone es PNG de 16 bits (space rgb16, depth ushort) y la
    // rechaza con 131053 "Image is invalid…". Lo mismo un JPEG en CMYK, un PNG
    // animado (APNG) o cualquier archivo que pase de 5 MB.
    const yaEnviable =
      (format === "jpeg" || format === "png") &&
      meta.depth === "uchar" &&
      (meta.space === "srgb" || meta.space === "b-w") &&
      (meta.pages ?? 1) <= 1 &&
      buffer.length <= MAX_IMAGE_BYTES;
    if (yaEnviable) {
      return {
        buffer,
        mime: format === "jpeg" ? "image/jpeg" : "image/png",
        converted: false,
      };
    }
    // Re-codificar. Con transparencia va PNG de 8 bits (JPEG la pintaría de
    // negro); sin transparencia, JPEG, que pesa mucho menos. GIF/APNG pierden
    // la animación: WhatsApp tampoco los acepta como `image`.
    const destino: "png" | "jpeg" = meta.hasAlpha ? "png" : "jpeg";
    const reencode = (maxLado: number, quality: number) => {
      const pipe = sharp(buffer)
        .rotate() // respeta la orientación EXIF antes de tirar los metadatos
        .resize({
          width: maxLado,
          height: maxLado,
          fit: "inside",
          withoutEnlargement: true,
        })
        // Baja a 8 bits por canal y aplana Display P3 / CMYK a sRGB.
        .toColourspace("srgb");
      return destino === "png"
        ? pipe.png({ compressionLevel: 9, palette: false }).toBuffer()
        : pipe.jpeg({ quality, mozjpeg: true }).toBuffer();
    };
    const mime = destino === "png" ? "image/png" : "image/jpeg";
    const salida = await reencode(MAX_DIMENSION, 85);
    if (salida.length <= MAX_IMAGE_BYTES) return { buffer: salida, mime, converted: true };
    const menor = await reencode(1600, 72);
    if (menor.length <= MAX_IMAGE_BYTES) return { buffer: menor, mime, converted: true };
    // Sigue sin entrar: como último recurso se sacrifica la transparencia
    // (fondo blanco) y se baja la calidad — un JPEG chico siempre entra.
    const plano = await sharp(buffer)
      .rotate()
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .jpeg({ quality: 65, mozjpeg: true })
      .toBuffer();
    return { buffer: plano, mime: "image/jpeg", converted: true };
  } catch {
    // No es una imagen que sharp entienda: que siga el camino normal.
    return unchanged;
  }
}

/** Cambia la extensión del nombre de archivo a .jpg conservando el resto. */
export function toJpegFileName(name: string | undefined): string | undefined {
  return renameForMime(name, "image/jpeg");
}

/** Alinea la extensión del nombre con el mime real tras la conversión. */
export function renameForMime(
  name: string | undefined,
  mime: string,
): string | undefined {
  if (!name) return name;
  const ext = mime === "image/png" ? "png" : "jpg";
  return name.includes(".") ? `${name.replace(/\.[^.]+$/, "")}.${ext}` : `${name}.${ext}`;
}

/**
 * Red de seguridad en el envío: si la URL apunta a un formato que WhatsApp no
 * acepta, la descarga, la convierte a JPEG, la sube a Storage y devuelve una
 * URL firmada que Meta puede descargar. Si ya es JPEG/PNG (o falla cualquier
 * paso) devuelve una URL descargable de la original.
 *
 * Devuelve SIEMPRE algo que un tercero pueda bajar sin cookies: es lo que se
 * le entrega a Meta, que descarga el archivo por su cuenta. Un adjunto propio
 * entra como `/api/media/…`, que sin firmar no le sirve a nadie de fuera.
 *
 * El objeto convertido se cachea por hash de la ruta original, así una misma
 * imagen de producto se transcodifica una sola vez. El hash NO se calcula
 * sobre la URL firmada: la firma cambia en cada envío y el caché nunca
 * acertaría.
 */
export async function ensureSendableImageUrl(url: string, workspaceId: string): Promise<string> {
  const fetchable = await resolveMediaFetchUrl(url, workspaceId);
  try {
    const file = await downloadPublicMedia(fetchable, 25 * 1024 * 1024, 20_000);
    if (!file) return fetchable;
    const safe = await toSendableImage(file.buffer, file.mime);
    if (!safe.converted) return fetchable;

    const key = createHash("sha1")
      .update(storagePathFromUrl(url) ?? url)
      .digest("hex");
    const path = `${workspaceId}/transcoded/${key}.${safe.mime === "image/png" ? "png" : "jpg"}`;
    const db = supabaseAdmin();
    const { error } = await db.storage.from(BUCKET).upload(path, safe.buffer, {
      contentType: safe.mime,
      upsert: true,
      cacheControl: "31536000",
    });
    if (error) {
      console.warn("[image-compat] transcode upload failed:", error.message);
      return fetchable;
    }
    const signed = await signMediaPath(path, OUTBOUND_SIGNED_TTL_SECONDS);
    return signed ?? fetchable;
  } catch (err) {
    console.warn("[image-compat] transcode skipped:", err);
    return fetchable;
  }
}
