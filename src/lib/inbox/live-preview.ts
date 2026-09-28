import type { Conversation, Message } from '@/types';
import { mediaPreviewToken } from '@/lib/channels/display';

const previewKeys = ['last_message_text', 'last_message_at', 'last_sender_type', 'last_message_status', 'last_message_hidden'] as const;

/** A delayed conversation update must not rewind a fresher message INSERT. */
export function mergeLiveConversation(current: Conversation, incoming: Conversation): Conversation {
  const merged = { ...current, ...incoming, contact: incoming.contact ?? current.contact };
  if (Date.parse(incoming.last_message_at ?? '') < Date.parse(current.last_message_at ?? '')) {
    for (const key of previewKeys) Object.assign(merged, { [key]: current[key] });
  }
  return merged;
}

/** Same preview for customer, manual, AI and public-comment messages. */
export function previewFromMessage(conversation: Conversation, message: Message): Conversation {
  if (message.conversation_id !== conversation.id || message.deleted_at || message.status === 'failed' ||
      !Number.isFinite(Date.parse(message.created_at)) ||
      Date.parse(message.created_at) < Date.parse(conversation.last_message_at ?? '')) return conversation;
  return {
    ...conversation,
    last_message_text: message.content_text?.trim() || mediaPreviewToken(message.media_mime ?? message.media_type),
    last_message_at: message.created_at,
    last_sender_type: message.sender_type,
    last_message_status: message.status,
    last_message_hidden: message.is_hidden ?? false,
  };
}

export function latestPreviewMessage(messages: Message[]): Message | undefined {
  return messages.filter(m => !m.deleted_at && m.status !== 'failed' && Number.isFinite(Date.parse(m.created_at)))
    .reduce<Message | undefined>((latest, message) => !latest || Date.parse(message.created_at) > Date.parse(latest.created_at) ? message : latest, undefined);
}
