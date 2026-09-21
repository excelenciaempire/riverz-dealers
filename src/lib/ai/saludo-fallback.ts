const SOLO_SALUDO =
  /^[¡¿\s]*(?:hola(?:,?\s+(?:buen(?:os?)?\s+d[ií]as?|buenas\s+(?:tardes|noches)))?|buen(?:os?)?\s+d[ií]as?|buenas\s+(?:tardes|noches))[\s!¡¿?,.]*$/iu;

/** Safe response used only when the model provider failed on a plain greeting.
 * It keeps the conversation moving without guessing why the customer returned. */
export function respuestaDeRespaldoParaSaludo(
  text: string | null | undefined,
  language: string | null | undefined
): string | null {
  if (!SOLO_SALUDO.test((text ?? '').trim())) return null;
  const lang = (language ?? 'es').toLowerCase().slice(0, 2);
  if (lang === 'en') return 'Hi! 😊 How can I help you?';
  if (lang === 'pt') return 'Olá! 😊 Como posso ajudar?';
  return '¡Hola! 😊 ¿Cómo puedo ayudarte?';
}
