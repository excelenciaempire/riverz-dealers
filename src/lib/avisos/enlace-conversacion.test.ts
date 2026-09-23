import { describe, expect, it } from 'vitest';
import {
  compactarConversationId,
  expandirConversationId,
} from './enlace-conversacion';

describe('enlaces cortos de conversación', () => {
  const id = 'cc9a2738-7a15-4e72-8e22-7bd158e15e21';

  it('acorta un UUID y lo recupera sin pérdida', () => {
    const token = compactarConversationId(id);
    expect(token).toHaveLength(22);
    expect(expandirConversationId(token!)).toBe(id);
  });

  it('rechaza valores que no son identificadores válidos', () => {
    expect(compactarConversationId('c1')).toBeNull();
    expect(expandirConversationId('not-a-token')).toBeNull();
  });
});
