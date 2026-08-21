/**
 * Direcciones de los adjuntos de conversación.
 *
 * El bucket `message-media` guarda lo que entra por WhatsApp, Instagram y
 * Messenger: fotos, comprobantes de pago, capturas de documentos y notas de
 * voz de las clientas. Fue público hasta la migración 141, así que cualquiera
 * con la URL leía el archivo, sin sesión y sin importar el workspace. Ahora es
 * privado y hay exactamente dos formas de llegar al contenido:
 *
 *   1. La bandeja pide `/api/media/<ruta>`. Esa ruta comprueba la sesión y la
 *      pertenencia al workspace, y recién ahí firma. Es lo que se guarda en
 *      `messages.media_url`, así que el enlace no caduca aunque la firma sí.
 *
 *   2. Los envíos salientes firman en el momento. Meta descarga el archivo por
 *      su cuenta desde el enlace que le pasamos, o sea que necesita una URL
 *      que funcione sin cookies; una firma de un día cubre el envío y sus
 *      reintentos sin dejar el objeto abierto para siempre.
 *
 * Las filas viejas guardan la URL pública absoluta de Supabase. La migración
 * las reescribe, pero `resolveMediaFetchUrl` también las reconoce por si
 * alguna se escapó: mejor volver a firmar que servir un 400.
 */

import { supabaseAdmin } from "./admin-client";

export const MEDIA_BUCKET = "message-media";

/** Prefijo de las URLs que sirve la app. */
const APP_PREFIX = "/api/media/";

/** Marca del formato viejo: `…/storage/v1/object/public/message-media/<ruta>`. */
const LEGACY_PUBLIC_MARKER = `/storage/v1/object/public/${MEDIA_BUCKET}/`;

/** Firma para la bandeja: la pestaña queda abierta, pero no un día entero. */
export const INBOX_SIGNED_TTL_SECONDS = 5 * 60;

/** Firma para un envío: Meta descarga enseguida y reintenta si falla. */
export const OUTBOUND_SIGNED_TTL_SECONDS = 24 * 60 * 60;

/**
 * URL estable que se guarda en `messages.media_url`. Relativa a propósito: no
 * depende de qué dominio sirva la app, así que sobrevive a una mudanza de
 * hosting y a los entornos de vista previa.
 */
export function appMediaUrl(storagePath: string): string {
  return `${APP_PREFIX}${storagePath.replace(/^\/+/, "")}`;
}

/**
 * Ruta dentro del bucket a partir de cualquiera de las formas conocidas, o
 * null si la URL apunta a otro sitio (una CDN de Shopify, por ejemplo).
 */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;

  const withoutQuery = raw.split("?")[0];

  const legacyAt = withoutQuery.indexOf(LEGACY_PUBLIC_MARKER);
  if (legacyAt !== -1) {
    return decodePath(withoutQuery.slice(legacyAt + LEGACY_PUBLIC_MARKER.length));
  }

  // Forma de la app, relativa (`/api/media/…`) o absoluta (`https://…/api/media/…`).
  const appAt = withoutQuery.indexOf(APP_PREFIX);
  if (appAt !== -1) {
    return decodePath(withoutQuery.slice(appAt + APP_PREFIX.length));
  }

  return null;
}

/** ¿La URL apunta a un adjunto nuestro? */
export function isManagedMediaUrl(url: string | null | undefined): boolean {
  return storagePathFromUrl(url) !== null;
}

function decodePath(path: string): string | null {
  const trimmed = path.replace(/^\/+/, "");
  if (!trimmed) return null;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

/**
 * Ruta del bucket a partir de los segmentos de una URL, o null si alguno no
 * puede ser un nombre de archivo nuestro.
 *
 * Next ya entrega los segmentos DECODIFICADOS. Las dos rutas de lectura los
 * volvían a decodificar, y esa segunda vuelta era una travesía de directorios:
 * `%252e%252e` llega como `%2e%2e`, el segundo decode lo convierte en `..`, y
 * el parser de URL lo colapsa dentro del enlace firmado. Con eso, los dos
 * primeros segmentos —que son justo los que se comparan contra la sesión—
 * dejaban de decidir nada: bastaba poner los propios y subir con `..` hasta el
 * adjunto de otra cuenta. Por ahí viajan comprobantes de pago y documentos.
 *
 * Así que no se decodifica de nuevo y se acepta sólo lo que esta app escribe:
 * ids y nombres planos. Es una lista blanca a propósito: enumerar lo que hay
 * que prohibir es exactamente cómo se llegó hasta acá.
 */
const SEGMENTO_SEGURO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function storagePathFromSegments(segments: string[]): string | null {
  if (segments.length === 0) return null;
  for (const s of segments) {
    if (!SEGMENTO_SEGURO.test(s) || s.includes('..')) return null;
  }
  return segments.join('/');
}

/**
 * URL firmada de un objeto del bucket. null si Storage la rechaza (objeto
 * borrado, ruta mal formada) — quien llama decide si eso es fatal.
 */
export async function signMediaPath(
  storagePath: string,
  expiresInSeconds: number,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .storage.from(MEDIA_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) {
    console.warn("[media-url] no pude firmar", storagePath, error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * URL que un tercero puede descargar sin cookies.
 *
 * Si es un adjunto nuestro devuelve una firma nueva; si es de fuera (Shopify,
 * una CDN) la devuelve tal cual. Ante un fallo de firma devuelve la original:
 * el envío fallará después con un error de Meta, que es más informativo que
 * romper acá.
 *
 * Todo lo que entregue una URL de adjunto a Meta, a Anthropic o a un fetch del
 * servidor tiene que pasar por acá.
 */
export async function resolveMediaFetchUrl(
  url: string,
  expiresInSeconds = OUTBOUND_SIGNED_TTL_SECONDS,
): Promise<string> {
  const path = storagePathFromUrl(url);
  if (!path) return url;
  const signed = await signMediaPath(path, expiresInSeconds);
  return signed ?? url;
}
