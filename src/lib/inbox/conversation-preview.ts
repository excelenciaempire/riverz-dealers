import type { Message, MessageStatus, SenderType } from '@/types';

export interface ConversationPreviewPatch {
  last_message_text: string | null;
  last_message_at: string | null;
  last_sender_type: SenderType | null;
  last_message_status: MessageStatus | null;
  last_message_hidden: boolean;
}

type PreviewMessage = Pick<
  Message,
  | 'content_text'
  | 'content_type'
  | 'subject'
  | 'media_type'
  | 'created_at'
  | 'sender_type'
  | 'status'
  | 'is_hidden'
>;

function mediaToken(message: PreviewMessage): string {
  const type = message.media_type ?? message.content_type;
  if (type === 'image' || type === 'sticker') return '[Imagen]';
  if (type === 'video') return '[Video]';
  if (type === 'audio' || type === 'voice') return '[Audio]';
  if (type === 'document') return '[Documento]';
  return '';
}

/** Rebuilds the denormalized inbox preview from the newest visible message. */
export function conversationPreviewFromMessage(
  message: PreviewMessage | null,
): ConversationPreviewPatch {
  if (!message) {
    return {
      last_message_text: null,
      last_message_at: null,
      last_sender_type: null,
      last_message_status: null,
      last_message_hidden: false,
    };
  }

  const text =
    message.content_text?.trim() ||
    message.subject?.trim() ||
    mediaToken(message);
  return {
    last_message_text: text ? text.slice(0, 200) : null,
    last_message_at: message.created_at,
    last_sender_type: message.sender_type,
    last_message_status:
      message.sender_type === 'customer' ? null : message.status,
    last_message_hidden: Boolean(message.is_hidden),
  };
}
