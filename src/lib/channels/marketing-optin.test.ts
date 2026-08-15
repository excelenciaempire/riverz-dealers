/**
 * Marketing Messages: detección del evento y cooldown de 48 h.
 *
 * Las dos cosas que, si fallan, fallan en silencio y en producción: un opt-in
 * que no se reconoce se descarta sin dejar rastro (se pierde el token), y un
 * cooldown mal calculado quema entregas contra un tope de Meta que no avisa
 * antes, sólo rechaza.
 */
import { describe, it, expect } from 'vitest';
import { isMarketingOptin, MARKETING_COOLDOWN_MS } from './marketing-optin';

describe('isMarketingOptin', () => {
  it('reconoce la aceptación real de Meta', () => {
    expect(
      isMarketingOptin({
        type: 'notification_messages',
        notification_messages_token: 'TOKEN123',
        token_expiry_timestamp: 1789000000,
        title: 'Ofertas y novedades',
      }),
    ).toBe(true);
  });

  it('ignora un opt-in de otro tipo', () => {
    // El checkbox plugin y los m.me links también llegan como `optin`, pero no
    // traen token: tratarlos como suscripción crearía filas sin con qué enviar.
    expect(isMarketingOptin({ type: 'checkbox', ref: 'algo' })).toBe(false);
  });

  it('ignora el tipo correcto sin token', () => {
    expect(isMarketingOptin({ type: 'notification_messages' })).toBe(false);
  });

  it('no explota con null ni con un string', () => {
    expect(isMarketingOptin(null)).toBe(false);
    expect(isMarketingOptin(undefined)).toBe(false);
    expect(isMarketingOptin('notification_messages')).toBe(false);
  });
});

describe('cooldown de Marketing Messages', () => {
  it('son 48 horas exactas', () => {
    // Meta lo subió de 24 h a 48 h el 1-sep-2025. Si esta constante vuelve a
    // 24, la mitad de los envíos de una campaña rebotan.
    expect(MARKETING_COOLDOWN_MS).toBe(48 * 60 * 60 * 1000);
  });

  it('un envío de hoy deja al suscriptor fuera de una campaña de mañana', () => {
    const lastSent = new Date('2026-08-14T10:00:00Z');
    const nextEligible = new Date(lastSent.getTime() + MARKETING_COOLDOWN_MS);
    expect(nextEligible.toISOString()).toBe('2026-08-16T10:00:00.000Z');
    // 24 h después todavía no: el error clásico es asumir "una por día".
    expect(new Date('2026-08-15T10:00:00Z') < nextEligible).toBe(true);
  });
});
