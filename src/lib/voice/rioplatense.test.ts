import { describe, it, expect } from 'vitest';
import { countryOfPhone, normalizeForDialing } from '@/lib/whatsapp/phone-utils';
import {
  DEFAULT_GREETING_AR,
  DEFAULT_GREETINGS,
  RIOPLATENSE_SPEECH,
} from './constants';

/**
 * El acento rioplatense se activa por el país del NÚMERO ya normalizado. Estas
 * pruebas fijan esa decisión: qué números cuentan como Argentina y cuáles no.
 * La reescritura fonética en sí vive en `voice-worker/test_rioplatense.py`.
 */
const isAr = (phone: string, country: string | null = null) =>
  countryOfPhone(normalizeForDialing(phone, country) || phone) === 'AR';

describe('detección de Argentina para el acento', () => {
  it('reconoce móviles argentinos en E.164 (con el 9)', () => {
    expect(isAr('+5491123456789')).toBe(true);
  });

  it('reconoce fijos de Buenos Aires', () => {
    expect(isAr('+541143216789')).toBe(true);
  });

  it('normaliza un número local argentino usando el país del comercio', () => {
    // Guardado sin código de país; el país llega de la dirección/WhatsApp.
    expect(isAr('1123456789', 'AR')).toBe(true);
  });

  it('NO se activa para otros países hispanohablantes', () => {
    expect(isAr('+573001234567')).toBe(false); // Colombia
    expect(isAr('+5215512345678')).toBe(false); // México
    expect(isAr('+34612345678')).toBe(false); // España
    expect(isAr('+59891234567')).toBe(false); // Uruguay (rioplatense, pero no AR)
  });

  it('NO se activa para el número de prueba de EE.UU.', () => {
    expect(isAr('+19544945872')).toBe(false);
  });

  it('no explota con basura', () => {
    expect(isAr('')).toBe(false);
    expect(isAr('no-es-un-teléfono')).toBe(false);
  });
});

describe('saludo argentino', () => {
  it('usa voseo en vez del tuteo neutro', () => {
    expect(DEFAULT_GREETING_AR).toContain('Tenés');
    expect(DEFAULT_GREETING_AR).not.toContain('Tienes');
    // El neutro se queda como está para el resto de los países.
    expect(DEFAULT_GREETINGS.es).toContain('Tienes');
  });

  it('mantiene el marcador de nombre para interpolar el contacto', () => {
    expect(DEFAULT_GREETING_AR).toContain('{{contact_name}}');
  });
});

describe('instrucciones rioplatenses', () => {
  it('pide voseo y prohíbe el tuteo', () => {
    expect(RIOPLATENSE_SPEECH).toContain('vos');
    expect(RIOPLATENSE_SPEECH).toContain('tenés');
    expect(RIOPLATENSE_SPEECH).toContain('Nunca "tú"');
  });

  it('hereda del skill veo3 la regla de símbolos que rompen la síntesis', () => {
    expect(RIOPLATENSE_SPEECH).toContain('guiones largos');
  });

  it('NO le pide al modelo escribir fonético — eso pasa en el worker', () => {
    // Si el LLM escribiera "cashe", la transcripción de la bandeja quedaría
    // ilegible para el comercio. La fonética se aplica sólo ante el TTS.
    expect(RIOPLATENSE_SPEECH).not.toMatch(/cashe|sho\b|fonétic/i);
  });
});
