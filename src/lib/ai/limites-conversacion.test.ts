import { describe, expect, it } from 'vitest';
import { normalizarLimitesDeConversacion, type ContextMessage } from './runner';

const customer = (content: string): ContextMessage => ({
  role: 'user',
  content,
});
const assistant = (content: string): ContextMessage => ({
  role: 'assistant',
  content,
});

describe('normalizarLimitesDeConversacion', () => {
  it('descarta el prefijo y sufijo del asistente antes de llamar al modelo', () => {
    const messages = normalizarLimitesDeConversacion(
      [assistant('Hola'), customer('Necesito ayuda'), assistant('Claro')],
      customer('Hola.')
    );

    expect(messages).toEqual([customer('Necesito ayuda')]);
  });

  it('usa un mensaje de cliente si no queda historial utilizable', () => {
    const fallback = customer('Hola, soy Pilar.');

    expect(
      normalizarLimitesDeConversacion(
        [assistant('Respuesta anterior')],
        fallback
      )
    ).toEqual([fallback]);
  });
});
