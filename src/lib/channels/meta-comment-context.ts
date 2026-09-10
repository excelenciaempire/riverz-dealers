/**
 * Messenger inserta este aviso técnico al abrir un privado desde un
 * comentario. No lo escribió el comercio ni el cliente y, además, Meta lo
 * entrega en inglés aunque la cuenta opere en español. El comentario original
 * ya se guarda como `comment_inbound`, así que mostrar también este eco sólo
 * agrega una burbuja duplicada y fuera de idioma.
 */
const COMMENT_CONTEXT_NOTICE =
  /^You are responding to a user comment to a post on your Page\.\s*View comment\.?\s*\(https?:\/\/[^\s)]+\)\s*$/i;

export function isMetaCommentContextNotice(text: unknown): boolean {
  return COMMENT_CONTEXT_NOTICE.test(String(text ?? '').trim());
}
