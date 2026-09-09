import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { conversationPreviewFromMessage } from './conversation-preview';

function message(patch: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    conversation_id: 'c1',
    channel: 'whatsapp',
    sender_type: 'customer',
    content_type: 'text',
    content_text: 'CONFIRMAR',
    status: 'read',
    created_at: '2026-09-09T21:03:20Z',
    ...patch,
  };
}

describe('preview de conversación', () => {
  it('rebobina al texto del mensaje anterior', () => {
    expect(conversationPreviewFromMessage(message())).toEqual({
      last_message_text: 'CONFIRMAR',
      last_message_at: '2026-09-09T21:03:20Z',
      last_sender_type: 'customer',
      last_message_status: null,
      last_message_hidden: false,
    });
  });

  it('conserva el estado saliente y el marcador de contenido multimedia', () => {
    expect(
      conversationPreviewFromMessage(
        message({
          sender_type: 'bot',
          content_type: 'audio',
          content_text: undefined,
          media_type: 'voice',
          status: 'delivered',
          is_hidden: true,
        }),
      ),
    ).toMatchObject({
      last_message_text: '[Audio]',
      last_sender_type: 'bot',
      last_message_status: 'delivered',
      last_message_hidden: true,
    });
  });

  it('vacía el preview cuando ya no quedan mensajes', () => {
    expect(conversationPreviewFromMessage(null)).toEqual({
      last_message_text: null,
      last_message_at: null,
      last_sender_type: null,
      last_message_status: null,
      last_message_hidden: false,
    });
  });
});
