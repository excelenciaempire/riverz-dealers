import { describe, it, expect } from 'vitest';
import type { Conversation, Message } from '@/types';
import { previewFromMessage, mergeLiveConversation, latestPreviewMessage } from './live-preview';
const conversation = { id: 'chat', channel: 'whatsapp', last_message_text: 'Respuesta anterior', last_message_at: '2026-09-28T14:23:00Z', unread_count: 0 } as Conversation;
const message = { id: 'new', conversation_id: 'chat', sender_type: 'customer', content_text: 'Solicito devolución', created_at: '2026-09-28T14:24:00Z', status: 'delivered' } as Message;
describe('live inbox preview', () => {
  it.each(['whatsapp', 'instagram', 'ig_comment', 'fb_comment', 'tiktok_comment'])('shows the newest received message in %s', channel => {
    const next = previewFromMessage({ ...conversation, channel } as Conversation, message);
    expect(next.last_message_text).toBe('Solicito devolución');
    expect(next.last_sender_type).toBe('customer');
    expect(next.last_message_status).toBe('delivered');
  });
  it('shows the final AI chunk and local manual sends immediately', () => {
    const next = previewFromMessage(conversation, { ...message, sender_type: 'bot', content_text: 'Lo reviso y te confirmo por aquí.' });
    expect(next.last_message_text).toBe('Lo reviso y te confirmo por aquí.');
    expect(previewFromMessage(next, { ...message, id: 'temp-1', created_at: '2026-09-28T14:25:00Z', sender_type: 'agent', content_text: 'Confirmado.' }).last_message_text).toBe('Confirmado.');
  });
  it('does not rewind on delayed database updates or older-history loads', () => {
    const current = previewFromMessage(conversation, message);
    const merged = mergeLiveConversation(current, { ...conversation, needs_human_reason: 'problema_detectado' });
    expect(merged.last_message_text).toBe(message.content_text);
    expect(merged.needs_human_reason).toBe('problema_detectado');
    expect(previewFromMessage(current, { ...message, created_at: '2026-09-27T00:00:00Z' })).toBe(current);
  });
  it('selects the latest visible message without depending on response ordering', () => {
    expect(latestPreviewMessage([{ ...message, id: 'failed', created_at: '2026-09-28T14:26:00Z', status: 'failed' }, message, { ...message, id: 'older', created_at: conversation.last_message_at! }])?.id).toBe('new');
  });
  it('does not leak previews from another chat or deleted messages', () => {
    expect(previewFromMessage(conversation, { ...message, conversation_id: 'other' })).toBe(conversation);
    expect(previewFromMessage(conversation, { ...message, deleted_at: message.created_at })).toBe(conversation);
  });
});
