/**
 * Una URL escrita por un modelo no es una URL confiable.
 *
 * También reconoce dominios sin protocolo y rutas rotas como
 * `store/products/x`: esta última apareció en un comentario público cuando el
 * recortador confundió los puntos del dominio con finales de oración.
 */
const URLISH =
  /\b(?:https?:\/\/|www\.)[^\s<>"']+|(?<!@)\b(?:[\p{L}\d-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?|\b(?:store|shop|tienda)\/(?:products?|productos?)\/[^\s<>"']+/giu;

function splitTrailingPunctuation(value: string): {
  core: string;
  suffix: string;
} {
  const match = value.match(/^(.*?)([),.!?;:]*)$/u);
  return {
    core: match?.[1] ?? value,
    suffix: match?.[2] ?? '',
  };
}

function canonicalUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(
      /^(?:https?:\/\/)/i.test(raw) ? raw : `https://${raw}`,
    );
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function cleanAfterRemoval(text: string): string {
  return text
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*[:–—-][ \t]*(?=\n|$)/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** En comentarios públicos los enlaces no son clicables: nunca se publican. */
export function stripPublicCommentUrls(text: string): string {
  return cleanAfterRemoval(text.replace(URLISH, ''));
}

/**
 * Deja pasar sólo URLs que provienen de datos reales de la tienda.
 *
 * Una URL desconocida se reemplaza por el primer enlace verificado. Si no hay
 * ninguno, se elimina: es preferible pedir que continúen por el chat a mandar
 * una dirección inventada o incompleta.
 */
export function enforceKnownUrls(text: string, knownUrls: string[]): string {
  const trusted = new Map<string, string>();
  for (const value of knownUrls) {
    const canonical = canonicalUrl(value);
    if (canonical && !trusted.has(canonical)) trusted.set(canonical, canonical);
  }
  const fallback = trusted.values().next().value as string | undefined;

  return cleanAfterRemoval(
    text.replace(URLISH, (match) => {
      const { core, suffix } = splitTrailingPunctuation(match);
      const canonical = canonicalUrl(core);
      const replacement = canonical ? trusted.get(canonical) : null;
      return `${replacement ?? fallback ?? ''}${suffix}`;
    }),
  );
}
