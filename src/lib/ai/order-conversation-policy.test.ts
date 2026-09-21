import { describe, expect, it } from 'vitest';
import { DEUNA_WORKSPACE, orderConversationModel } from './order-conversation-policy';
import { evidenceText } from './conversation-evidence';

const base = { workspaceId: DEUNA_WORKSPACE, configuredModel: 'claude-sonnet-5', hasOrder: true };
describe('Efra: retain uncertainty across buttons, screenshots and audio', () => {
  it('routes correction after confirmation to reasoning, even if the latest reply is yes', () => {
    expect(orderConversationModel({ ...base, messages: [
      { content: 'CONFIRMAR' }, { content: 'CORREGIR' },
      { content: '[Audio transcrito]: No estoy seguro si pedí los negritos.' },
      { content: 'Si está bien' },
    ] })).toBe('claude-opus-5');
  });
  it('retains BOTH human screenshots with their different quantities', () => {
    const one = evidenceText({ id: 'one', attachments: [{ url: '/one', evidence: { version: 1, kind: 'image', text: '1 Negro 39; 1 Negro con blanco 39' } }] });
    const two = evidenceText({ id: 'two', attachments: [{ url: '/two', evidence: { version: 1, kind: 'image', text: '2 Negro 39' } }] });
    expect(one).toContain('Negro con blanco 39');
    expect(two).toContain('2 Negro 39');
    expect(orderConversationModel({ ...base, messages: [{ content: one }, { content: two }, { content: 'Sí' }] })).toBe('claude-opus-5');
  });
  it('keeps unprocessed evidence explicitly unknown after CONFIRMAR', () => {
    const text = evidenceText({ id: 'voice', media_url: '/audio', media_type: 'voice' });
    expect(text).toContain('pendiente de interpretar');
    expect(orderConversationModel({ ...base, messages: [{ content: text }, { content: 'CONFIRMAR' }] })).toBe('claude-opus-5');
  });
  it('preserves routine model and other merchants configuration', () => {
    expect(orderConversationModel({ ...base, messages: [{ content: 'Cuánto tarda el envío?' }] })).toBe(base.configuredModel);
    expect(orderConversationModel({ ...base, workspaceId: 'another', messages: [{ content: 'CORREGIR', media: {} }] })).toBe(base.configuredModel);
  });
});
