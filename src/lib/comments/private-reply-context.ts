const MAX_COMMENT_EXCERPT = 180;

type SupportedLanguage = 'es' | 'en' | 'pt';

/**
 * Hace explícito por qué llegó un privado iniciado desde un comentario.
 *
 * Meta entrega el private reply como un mensaje nuevo. Aunque Riverz muestre
 * el comentario de origen dentro de la bandeja, la persona sólo ve el DM. Por
 * eso esta referencia se aplica justo antes de enviar y no se deja a criterio
 * del modelo ni de la plantilla.
 */
export function addCommentContextToPrivateReply(input: {
  reply: string;
  comment?: string | null;
  language?: string | null;
  /** Sólo si la red no muestra el comentario de origen. */
  agregar?: boolean;
}): string {
  const reply = input.reply.trim();
  // Meta ya muestra el comentario arriba del privado ("Estás respondiendo el
  // comentario..." con el link). Repetirlo era mandarle a la persona lo mismo
  // dos veces. Queda la opción para una red que no lo muestre.
  if (!input.agregar) return reply;
  const comment = normalizeWhitespace(input.comment ?? '');
  if (!reply || !comment) return reply;

  // Si el texto ya abre recordando el comentario, no repetimos la referencia.
  if (alreadyStartsWithCommentContext(reply, comment)) return reply;

  const excerpt = truncateComment(comment);
  const language = resolveLanguage(input.language, `${comment} ${reply}`);
  const opener =
    language === 'en'
      ? `I saw your comment: “${excerpt}”`
      : language === 'pt'
        ? `Vi seu comentário: “${excerpt}”`
        : `Vi tu comentario: “${excerpt}”`;

  return `${opener}\n\n${reply}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateComment(comment: string): string {
  const chars = Array.from(comment);
  if (chars.length <= MAX_COMMENT_EXCERPT) return comment;
  return `${chars
    .slice(0, MAX_COMMENT_EXCERPT - 1)
    .join('')
    .trimEnd()}…`;
}

function alreadyStartsWithCommentContext(
  reply: string,
  comment: string
): boolean {
  const start = normalizeWhitespace(reply).toLocaleLowerCase().slice(0, 260);
  const excerpt = truncateComment(comment).toLocaleLowerCase();
  if (start.includes(excerpt)) return true;
  return /^(vi|vimos|le[ií]|sobre|acerca de|gracias por)\s+(tu|su|el|ese|este)?\s*(comentario|comment|comentário)\b/i.test(
    start
  );
}

function resolveLanguage(
  language: string | null | undefined,
  text: string
): SupportedLanguage {
  const configured = (language ?? '').trim().toLowerCase();
  if (configured.startsWith('en') || configured.includes('ingl')) return 'en';
  if (configured.startsWith('pt') || configured.includes('portugu'))
    return 'pt';
  if (configured.startsWith('es') || configured.includes('espa')) return 'es';

  const normalized = ` ${text.toLowerCase()} `;
  if (
    /[¿¡ñáéíóúü]/.test(normalized) ||
    /\b(que|para|por|con|una|uno|tienen|quiero|precio|cuánto|gracias)\b/.test(
      normalized
    )
  ) {
    return 'es';
  }
  if (
    /[ãõç]/.test(normalized) ||
    /\b(voc[eê]|preço|obrigad[oa]|produto|comentário)\b/.test(normalized)
  ) {
    return 'pt';
  }
  return 'en';
}
