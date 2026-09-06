import { describe, expect, it } from 'vitest';
import { llamadaRota } from './result';
import type { VoiceTranscriptTurn } from './result';

const t = (role: 'agent' | 'customer', text: string): VoiceTranscriptTurn =>
  ({ role, text }) as VoiceTranscriptTurn;

/** La llamada real del 2026-08-28 que motivó todo esto. */
const LA_ROTA = [
  t('agent', 'Hola Prueba, te llamo de parte de la tienda. ¿Tienes un minuto?'),
  t('customer', '¿Cuál tienda?'),
  t('agent', 'Soy del equipo de Serum Pilar. ¿En qué puedo ayudarte?'),
  t('customer', '¿Qué me llamas?'),
  t('customer', '¿Hola?'),
];

describe('llamadaRota', () => {
  it('agarra la del 28 de agosto: habló dos veces y dejó al cliente hablando solo', () => {
    expect(
      llamadaRota({
        status: 'completed',
        connected: true,
        transcript: LA_ROTA,
        summary: 'un resumen cualquiera',
      })
    ).toMatch(/dejó de responder/);
  });

  it('agarra la que nunca habló (el saludo sale igual, lo dice el TTS)', () => {
    expect(
      llamadaRota({
        status: 'completed',
        connected: true,
        transcript: [t('customer', '¿Hola?')],
        summary: null,
      })
    ).toMatch(/no respondió/);
  });

  it('un resumen generado no convierte silencio del agente en respuesta', () => {
    expect(
      llamadaRota({
        status: 'completed',
        connected: true,
        transcript: [t('customer', 'Hola'), t('customer', '¿Me escuchas?')],
        summary: 'El cliente saludó dos veces y no recibió respuesta.',
      })
    ).toMatch(/no respondió/);
  });

  it('deja pasar una conversación sana', () => {
    expect(
      llamadaRota({
        status: 'completed',
        connected: true,
        transcript: [
          t('agent', '¿Confirmamos el pedido?'),
          t('customer', 'Sí, dale.'),
          t('agent', 'Listo, gracias.'),
        ],
        summary: 'pedido confirmado',
      })
    ).toBeNull();
  });

  it('un solo turno del cliente al final es normal, no un fallo', () => {
    // «Listo, gracias» y cuelga. Marcar esto como roto llenaría el registro de
    // falsos fallos, que es la forma más rápida de que nadie mire el registro.
    expect(
      llamadaRota({
        status: 'completed',
        connected: true,
        transcript: [
          t('agent', '¿Confirmamos el pedido?'),
          t('customer', 'Sí, listo, gracias.'),
        ],
        summary: 'ok',
      })
    ).toBeNull();
  });

  it('no opina sobre una llamada que no conectó ni sobre una ya fallida', () => {
    expect(
      llamadaRota({
        status: 'no_answer',
        connected: false,
        transcript: [],
        summary: null,
      })
    ).toBeNull();
    expect(
      llamadaRota({
        status: 'failed',
        connected: true,
        transcript: LA_ROTA,
        summary: null,
      })
    ).toBeNull();
  });
});
