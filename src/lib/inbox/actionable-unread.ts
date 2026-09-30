import type { Conversation } from '@/types';

/**
 * Un contador pendiente sólo es accionable mientras la última intervención
 * siga siendo del cliente. Si el equipo o la IA ya contestaron, conservar el
 * número histórico hace parecer que todavía falta responder.
 *
 * Los hilos antiguos sin `last_sender_type` conservan el contador: ante la
 * duda no escondemos algo que todavía podría requerir atención.
 */
export function actionableUnreadCount(
  conversation: Pick<Conversation, 'unread_count' | 'last_sender_type' | 'manual_unread' | 'is_spam'>
): number {
  if (conversation.is_spam) return 0;
  const unread = Math.max(0, conversation.unread_count ?? 0);
  if (conversation.manual_unread) return Math.max(1, unread);
  return conversation.last_sender_type === 'agent' ||
    conversation.last_sender_type === 'bot'
    ? 0
    : unread;
}
