/**
 * Los motivos por los que no se puede llamar.
 *
 * Lo que se protege acá es el silencio: durante meses una barrera frenaba la
 * llamada y el comercio no veía absolutamente nada — ni fila en el registro,
 * ni cartel en el lienzo, ni una frase en el historial de la corrida. Cada
 * motivo tiene ahora una frase, en los dos idiomas, y una sola: si alguien
 * agrega un código nuevo y se olvida del texto, se entera acá y no en boca de
 * un cliente.
 */
import { describe, it, expect } from 'vitest';
import { MESSAGES } from '@/lib/i18n/messages/registry';
import {
  blockerCodeFromReason,
  voiceStatusLabel,
  VOICE_BLOCKED_FIX_HREF,
  VOICE_BLOCKED_KEY,
  type VoiceBlockerCode,
} from './labels';

const CODIGOS = Object.keys(VOICE_BLOCKED_KEY) as VoiceBlockerCode[];

describe('cada motivo tiene su frase', () => {
  it('en el catálogo, y en los dos idiomas', () => {
    const faltan: string[] = [];
    for (const code of CODIGOS) {
      const entrada = MESSAGES[VOICE_BLOCKED_KEY[code]];
      if (!entrada) faltan.push(`${code}: no está en el catálogo`);
      else if (!entrada.es || !entrada.en) faltan.push(`${code}: falta un idioma`);
    }
    expect(faltan).toEqual([]);
  });

  it('y todos dicen dónde se arregla, o admiten que no lo arregla el comercio', () => {
    // `null` es una respuesta válida (la plataforma caída, un contacto dado de
    // baja); lo que no puede pasar es que falte la entrada y quede `undefined`.
    for (const code of CODIGOS) {
      expect(VOICE_BLOCKED_FIX_HREF).toHaveProperty(code);
    }
  });
});

describe('del motivo crudo de la cola al código', () => {
  it('traduce los que vienen tal cual', () => {
    expect(blockerCodeFromReason('kill_switch')).toBe('kill_switch');
    expect(blockerCodeFromReason('opt_out')).toBe('opt_out');
  });

  it('el fallo de guardado trae el detalle pegado y aun así se reconoce', () => {
    // `enqueueCall` devuelve `insert_failed:<mensaje de postgres>`, que no es
    // un código: sin recortarlo, el registro mostraba el error de la base.
    expect(blockerCodeFromReason('insert_failed:duplicate key')).toBe('insert_failed');
  });

  it('un motivo desconocido no rompe la pantalla', () => {
    expect(VOICE_BLOCKED_KEY[blockerCodeFromReason('algo_nuevo')]).toBeDefined();
  });
});

describe('cómo se lee una llamada en el registro', () => {
  it('una llamada que nunca se marcó dice eso, con el motivo', () => {
    const { statusKey, reasonKey } = voiceStatusLabel({
      status: 'canceled',
      error: 'kill_switch',
    });
    expect(statusKey).toBe('voice.statusNotPlaced');
    expect(reasonKey).toBe('voice.blockedKillSwitch');
  });

  it('una cancelada de verdad sigue siendo cancelada', () => {
    // La cancela el cron cuando el cliente ya contestó por texto: ahí sí hubo
    // una llamada en cola y se la dio de baja, que no es lo mismo que una que
    // una barrera nunca dejó salir.
    const { statusKey, reasonKey } = voiceStatusLabel({ status: 'canceled', error: null });
    expect(statusKey).toBe('voice.statusCanceled');
    expect(reasonKey).toBeNull();
  });

  it('el resto de los estados no cambian', () => {
    expect(voiceStatusLabel({ status: 'no_answer' }).statusKey).toBe('voice.statusNoAnswer');
    expect(voiceStatusLabel({ status: 'completed' }).statusKey).toBe('voice.statusCompleted');
  });
});
