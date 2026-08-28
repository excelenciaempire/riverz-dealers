/**
 * Descarga de adjuntos de la bandeja (entrantes y salientes).
 *
 * El atributo `download` de un <a> lo IGNORA el navegador cuando el href es
 * de otro origen (Supabase Storage, CDN de Meta): en vez de guardar, abre el
 * archivo en una pestaña. Por eso bajamos el archivo a un blob del mismo
 * origen y recién ahí disparamos el <a download>. Si el fetch falla (CORS de
 * un CDN ajeno, red), se abre en pestaña nueva: peor experiencia, pero el
 * archivo sigue siendo alcanzable.
 */

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "weba",
  "audio/wav": "wav",
  "application/pdf": "pdf",
};

function hasExtension(name: string): boolean {
  return /\.[a-z0-9]{2,5}$/i.test(name);
}

/** Nombre de archivo a partir de la URL, cuando el adjunto no trae uno. */
export function filenameFromUrl(url: string, fallback: string): string {
  try {
    const base = typeof window === "undefined" ? "http://x" : window.location.origin;
    const last = decodeURIComponent(new URL(url, base).pathname.split("/").pop() ?? "");
    return hasExtension(last) ? last : fallback;
  } catch {
    return fallback;
  }
}

/** Saca los caracteres que un sistema de archivos no acepta. */
function sanitize(name: string): string {
  return name.replace(/[\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "archivo";
}

function saveBlobUrl(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Guarda el archivo en el disco del usuario.
 * `blobUrl` es el blob que la burbuja ya bajó para mostrar la imagen: se
 * reusa para no pedir el archivo dos veces.
 */
export async function downloadMedia(
  url: string,
  name: string | undefined,
  fallbackName: string,
  blobUrl?: string | null,
): Promise<void> {
  let filename = sanitize(name?.trim() || filenameFromUrl(url, fallbackName));

  if (blobUrl?.startsWith("blob:")) {
    saveBlobUrl(blobUrl, filename);
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    if (!hasExtension(filename)) {
      const ext = EXT_BY_MIME[blob.type.split(";")[0].trim().toLowerCase()];
      if (ext) filename = `${filename}.${ext}`;
    }
    const href = URL.createObjectURL(blob);
    saveBlobUrl(href, filename);
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
