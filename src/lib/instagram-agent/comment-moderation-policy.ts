/** Revitaly's owner explicitly wants objections answered, not automatically hidden. */
export function shouldHideComment(
  workspaceId: string,
  spam: boolean,
  criticism: boolean
): boolean {
  const answerObjection =
    workspaceId === '234604a9-909b-4e50-952b-acde4a85593a' && criticism;
  return !answerObjection && (spam || criticism);
}

/** Revitaly handles public objections in-place; order cases still need privacy. */
export function keepObjectionPublic(workspaceId: string, criticism: boolean, hasOrderQuestion: boolean): boolean {
  return workspaceId === '234604a9-909b-4e50-952b-acde4a85593a' && criticism && !hasOrderQuestion;
}

/** Merchant-approved facts replace unsupported ad claims, rather than silence. */
export function safeObjectionReply(workspaceId: string, criticism: boolean, hasPrivateCase: boolean): string | null {
  if (!keepObjectionPublic(workspaceId, criticism, hasPrivateCase)) return null;
  return 'Entiendo tu duda. Revitaly es un shampoo cosmético de uso externo; los resultados varían entre personas y no prometemos crecimiento garantizado.';
}
