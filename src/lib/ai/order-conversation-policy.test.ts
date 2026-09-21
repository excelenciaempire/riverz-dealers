import { describe, expect, it } from 'vitest';
import {
  DEUNA_WORKSPACE,
  ORDER_CONVERSATION_POLICY,
  ORDER_OPERATION_POLICY,
  orderConversationModel,
} from './order-conversation-policy';
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
  it('routes offers and exact variant corrections to the stronger model', () => {
    for (const content of [
      'La oferta es pague 1 y lleve 2',
      'Quiero ambos talla 41',
      'Agrega otro par y cambia las tallas',
      'Uno blanco 41 y el otro negro 41',
    ]) {
      expect(orderConversationModel({ ...base, messages: [{ role: 'user', content }] }))
        .toBe('claude-opus-5');
    }
  });
  it('requires a verified Shopify result and forbids supplier notes as a workaround', () => {
    expect(ORDER_CONVERSATION_POLICY).toContain('promoción vigente');
    expect(ORDER_CONVERSATION_POLICY).toContain('confirmed=true');
    expect(ORDER_OPERATION_POLICY).toContain('verificación posterior');
    expect(ORDER_OPERATION_POLICY).toContain('Nunca uses notas al proveedor');
    expect(ORDER_OPERATION_POLICY).toContain('sin una operación verificada en Dropi');
    expect(ORDER_CONVERSATION_POLICY).toContain('Después de cualquiera de esos botones');
    expect(ORDER_CONVERSATION_POLICY).toContain('no menciones la validación');
  });
  it('preserves routine model and other merchants configuration', () => {
    expect(orderConversationModel({ ...base, messages: [{ role: 'assistant', content: 'Toca CONFIRMAR o CORREGIR' }, { role: 'user', content: 'CONFIRMAR' }] })).toBe(base.configuredModel);
    expect(orderConversationModel({ ...base, messages: [{ content: 'Cuánto tarda el envío?' }] })).toBe(base.configuredModel);
    expect(orderConversationModel({ ...base, workspaceId: 'another', messages: [{ content: 'CORREGIR', media: {} }] })).toBe(base.configuredModel);
  });
});
