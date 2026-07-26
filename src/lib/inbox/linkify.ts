/**
 * Detección de enlaces en el texto de un mensaje, para cualquier canal.
 *
 * Pura y sin React a propósito: la bandeja la usa para pintar los enlaces
 * clicables y los tests la cubren sin montar componentes.
 */

/** Dominios de primer nivel que aceptamos en un enlace escrito sin `https://`.
 *  La lista acotada es a propósito: sin ella "gracias.Hola" o "3.99" pasarían
 *  por enlace. Cubre los genéricos usados en comercio y los países de la
 *  región. */
const LINK_TLD =
  "com|net|org|io|co|app|ai|me|info|biz|shop|store|online|site|xyz|dev|link|page|club|tv|live|blog|es|ar|mx|cl|pe|uy|py|bo|ec|ve|br|us|uk|de|fr|it|pt|ca";

/**
 * Enlaces tal como los escribe la gente:
 *   1. correo (se abre en el cliente de mail)
 *   2. con esquema — https://pilar.store/serum
 *   3. con www — www.pilar.store
 *   4. a secas — pilarargentina.store/razones
 * El correo va primero para que "juan@pilar.com" no se parta en un enlace al
 * dominio.
 */
const LINK_RE = new RegExp(
  [
    String.raw`([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})`,
    String.raw`(https?:\/\/[^\s<>"']+)`,
    String.raw`(www\.[^\s<>"']+)`,
    String.raw`([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${LINK_TLD})(?![a-z])(?:\/[^\s<>"']*)?)`,
  ].join("|"),
  "gi",
);

export interface LinkToken {
  /** Índice donde arranca el enlace dentro del texto. */
  start: number;
  /** Índice donde termina TODO lo consumido (enlace + puntuación final). */
  end: number;
  /** El enlace tal como lo escribió la persona — es lo que se muestra. */
  text: string;
  /** Destino real (agrega `https://` o `mailto:` cuando hace falta). */
  href: string;
  /** Puntuación de cierre que quedó fuera del enlace ("…serum." no debe 404). */
  trailing: string;
  isEmail: boolean;
}

/** Puntuación de cierre de oración: no forma parte del enlace. */
function splitTrailingPunctuation(token: string): [string, string] {
  const trail = /[.,;:!?)\]}'"]+$/.exec(token)?.[0] ?? "";
  if (!trail) return [token, ""];
  return [token.slice(0, token.length - trail.length), trail];
}

export function findLinks(text: string): LinkToken[] {
  const out: LinkToken[] = [];
  if (!text) return out;
  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_RE.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;
    // Un carácter de palabra justo antes significa que esto es la cola de otro
    // token (un correo ya emitido, una URL más larga): no es un enlace nuevo.
    if (start > 0 && /[\w@/.-]/.test(text[start - 1])) continue;
    const [token, trailing] = splitTrailingPunctuation(raw);
    if (!token) continue;
    const isEmail = Boolean(match[1]);
    out.push({
      start,
      end: start + raw.length,
      text: token,
      href: isEmail
        ? `mailto:${token}`
        : /^https?:\/\//i.test(token)
          ? token
          : `https://${token}`,
      trailing,
      isEmail,
    });
  }
  return out;
}
