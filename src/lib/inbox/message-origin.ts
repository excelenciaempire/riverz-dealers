/**
 * De QUÉ funcionalidad salió un mensaje saliente (migración 143).
 *
 * Todo lo que Riverz envía solo —el asistente, un seguimiento, una
 * automatización, un flujo, una campaña, Comentarios, el agente de voz— deja
 * su marca en `messages.origin`, y la bandeja la muestra sobre la burbuja. Sin
 * esto el comercio veía un mensaje que él no escribió y no tenía forma de saber
 * qué apagar.
 *
 * `null` = lo escribió una persona (o llegó de la app del canal).
 */
export const MESSAGE_ORIGINS = [
  'ai_agent',
  'ai_followup',
  'comment_ai',
  'comment_rule',
  'ig_outreach',
  'automation',
  'flow',
  'broadcast',
  'voice_agent',
  'order_update',
] as const;

export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number];

/** Clave i18n de la etiqueta visible (namespace `inbox`). */
export function originLabelKey(origin: string): string {
  const key = ORIGIN_KEYS[origin as MessageOrigin];
  return key ? `inbox.${key}` : 'inbox.originAutomated';
}

const ORIGIN_KEYS: Record<MessageOrigin, string> = {
  ai_agent: 'originAiAgent',
  ai_followup: 'originAiFollowup',
  comment_ai: 'originCommentAi',
  comment_rule: 'originCommentRule',
  ig_outreach: 'originIgOutreach',
  automation: 'originAutomation',
  flow: 'originFlow',
  broadcast: 'originBroadcast',
  voice_agent: 'originVoiceAgent',
  order_update: 'originOrderUpdate',
};

/**
 * `kind` de `ig_proactive_log` → origen. Es el puente para los envíos que NO
 * escribimos nosotros en `messages`: el DM de una regla y la respuesta pública
 * de un comentario llegan a la bandeja por el eco de Meta, y ahí ya no queda
 * rastro de quién los originó salvo este libro.
 */
export function originFromProactiveKind(kind: string): MessageOrigin | null {
  switch (kind) {
    case 'comment':
      return 'comment_ai';
    case 'comment_public':
      return 'comment_ai';
    case 'comment_rule':
      return 'comment_rule';
    case 'outreach':
    case 'batch':
    case 'closer':
    case 'approval':
      return 'ig_outreach';
    default:
      return null;
  }
}
