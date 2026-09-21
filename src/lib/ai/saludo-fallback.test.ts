import { describe, expect, it } from 'vitest';
import { respuestaDeRespaldoParaSaludo } from './saludo-fallback';

describe('fallback for a plain greeting', () => {
  it.each([
    'Hola',
    'Hola buenas tardes',
    'Buen día',
    'Buenas noches!',
    '¡Hola, buenos días!',
  ])('keeps a normal conversation going for %s', (text) =>
    expect(respuestaDeRespaldoParaSaludo(text, 'es')).toBe(
      '¡Hola! 😊 ¿Cómo puedo ayudarte?'
    )
  );

  it.each([
    'Me confirmas la guía',
    'Hola, no llegó mi pedido',
    'Gracias',
    'Quiero comprar',
  ])('does not hide a substantive message: %s', (text) =>
    expect(respuestaDeRespaldoParaSaludo(text, 'es')).toBeNull()
  );

  it('uses the agent language', () => {
    expect(respuestaDeRespaldoParaSaludo('Hello', 'en')).toBeNull();
    expect(respuestaDeRespaldoParaSaludo('Hola', 'en')).toBe(
      'Hi! 😊 How can I help you?'
    );
  });
});
