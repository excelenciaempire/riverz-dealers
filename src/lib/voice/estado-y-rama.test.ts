import { describe, expect, it } from 'vitest';
import { VOICE_UNANSWERED_STATUSES } from '@/types';
import { llamadaRota } from './result';
import type { VoiceTranscriptTurn } from './result';

/**
 * El contrato entre cómo termina una llamada y qué rama corre después.
 *
 * Una llamada que sale de una automatización no termina cuando cuelga: la
 * corrida está estacionada esperando el resultado, y el `call_status` decide si
 * el cliente recibe el WhatsApp de «no pudimos hablar» o no recibe nada.
 *
 * La rama que arma el lienzo en un clic es `call_status == 'completed'` en el
 * caso, y TODO lo demás en el `else`. O sea que el contrato es binario y hay
 * que protegerlo desde los dos lados: lo que se considera atendido tiene que
 * ser exactamente lo que se atendió.
 */

const t = (role: 'agent' | 'customer', text: string): VoiceTranscriptTurn =>
  ({ role, text } as VoiceTranscriptTurn);

/** Espejo de la rama que arma `ramaSiNoContesta` en el lienzo. */
function ramaQueCorre(callStatus: string): 'atendida' | 'fallback' {
  return callStatus === 'completed' ? 'atendida' : 'fallback';
}

describe('cómo termina la llamada decide qué rama corre', () => {
  it('el agente que se quedó mudo manda al cliente por el fallback', () => {
    // Es el caso del 2026-08-28: habló dos veces, el modelo se cayó, y el
    // cliente repitió «¿hola?» hasta colgar. Antes esto llegaba como
    // `completed` y la automatización lo daba por atendido: el cliente se
    // quedaba sin la llamada Y sin el WhatsApp de respaldo.
    const roto = llamadaRota({
      status: 'completed',
      connected: true,
      transcript: [
        t('agent', 'Hola, te llamo de Pilar.'),
        t('customer', '¿Qué me llamas?'),
        t('customer', '¿Hola?'),
      ],
      summary: 'algo',
    });
    expect(roto).not.toBeNull();
    expect(ramaQueCorre(roto ? 'failed' : 'completed')).toBe('fallback');
  });

  it('una conversación sana va por la rama de atendida', () => {
    const roto = llamadaRota({
      status: 'completed',
      connected: true,
      transcript: [
        t('agent', '¿Confirmamos el pedido?'),
        t('customer', 'Sí, dale.'),
        t('agent', 'Listo, gracias.'),
      ],
      summary: 'confirmado',
    });
    expect(roto).toBeNull();
    expect(ramaQueCorre('completed')).toBe('atendida');
  });

  it('«fallida» no encadena reintentos', () => {
    // Si `failed` entrara en la lista de no-contestadas, una llamada rota por
    // un modelo caído volvería a marcar sola: el cliente atiende otra vez para
    // escuchar el mismo silencio, y el comercio lo paga cada vez.
    expect(VOICE_UNANSWERED_STATUSES).not.toContain('failed');
  });

  it('lo que sí reintenta es lo que de verdad no atendieron', () => {
    expect(VOICE_UNANSWERED_STATUSES).toContain('no_answer');
    expect(VOICE_UNANSWERED_STATUSES).toContain('busy');
    expect(VOICE_UNANSWERED_STATUSES).toContain('voicemail');
  });

  it('todo lo que no es «completed» cae en el fallback', () => {
    // El lienzo arma UN caso (`completed`) y manda el resto al else. Este test
    // existe para que agregar un estado nuevo no lo deje sin rama por olvido.
    for (const s of ['no_answer', 'busy', 'voicemail', 'failed', 'canceled', 'not_placed']) {
      expect(ramaQueCorre(s)).toBe('fallback');
    }
  });
});
