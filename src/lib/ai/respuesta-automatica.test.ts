import { describe, expect, it } from 'vitest';
import { esRespuestaAutomatica } from './respuesta-automatica';

describe('esRespuestaAutomatica', () => {
  it('reconoce el contestador de WhatsApp Business (caso del 2026-09-15)', () => {
    expect(
      esRespuestaAutomatica(
        'Hola 😊 ¡Gracias por comunicarte con Juliana Vargas 🕘 Horarios de atención: •Lunes a sábado: 9:00 a. m. a 1:00 p. m. y 2:00 p. m. a 7:00 p. m. Quedamos atentos a tu mensaje 💇♀️✨ ❌Recuerda no contestamos llamadas, sólo WhatsApp'
      )
    ).toBe(true);
  });

  it('reconoce el aviso explícito de mensaje automático', () => {
    expect(
      esRespuestaAutomatica(
        'Este es un mensaje automático. Nuestro equipo te responderá cuando esté disponible.'
      )
    ).toBe(true);
  });

  it('no confunde a una persona que agradece', () => {
    expect(esRespuestaAutomatica('Gracias por escribirme, sí quiero el rascador en color lila')).toBe(false);
    expect(esRespuestaAutomatica('Hola, ¿a qué hora atienden? Quiero pasar a recoger')).toBe(false);
    expect(esRespuestaAutomatica('MANTENER CONTRAENTREGA')).toBe(false);
  });

  it('un mensaje corto nunca es contestador', () => {
    expect(esRespuestaAutomatica('Horarios de atención?')).toBe(false);
    expect(esRespuestaAutomatica(null)).toBe(false);
  });
});
