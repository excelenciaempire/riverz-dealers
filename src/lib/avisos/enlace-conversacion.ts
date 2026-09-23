const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Convierte un UUID en 22 caracteres seguros para una URL. */
export function compactarConversationId(conversationId: string): string | null {
  if (!UUID.test(conversationId)) return null;
  return Buffer.from(conversationId.replaceAll('-', ''), 'hex').toString(
    'base64url'
  );
}

/** Recupera el UUID de un enlace corto sin aceptar identificadores arbitrarios. */
export function expandirConversationId(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  const hex = Buffer.from(token, 'base64url').toString('hex');
  if (hex.length !== 32) return null;
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID.test(uuid) ? uuid : null;
}
