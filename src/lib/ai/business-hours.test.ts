import { describe, it, expect } from 'vitest';
import { withinBusinessHours, containsEscalationKeyword } from './business-hours';
import type { BusinessHours } from './types';

// Zona fija para que el test no dependa de la máquina. UTC evita sorpresas
// de horario de verano.
const TZ = 'UTC';

/** Lun=1 … Dom=0, igual que el JSONB `business_hours.windows`. */
function hours(windows: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string[]>>): BusinessHours {
  return { timezone: TZ, windows: windows as BusinessHours['windows'] };
}

/** 2026-07-27 fue LUNES. */
const MON = (hhmm: string) => new Date(`2026-07-27T${hhmm}:00Z`);
const TUE = (hhmm: string) => new Date(`2026-07-28T${hhmm}:00Z`);

describe('withinBusinessHours — ventana normal', () => {
  const bh = hours({ 1: ['09:00-18:00'] });

  it('dentro de la franja', () => {
    expect(withinBusinessHours(bh, MON('12:00'))).toBe(true);
  });

  it('justo al abrir es dentro', () => {
    expect(withinBusinessHours(bh, MON('09:00'))).toBe(true);
  });

  it('justo al cerrar ya es fuera', () => {
    expect(withinBusinessHours(bh, MON('18:00'))).toBe(false);
  });

  it('antes de abrir', () => {
    expect(withinBusinessHours(bh, MON('08:59'))).toBe(false);
  });

  it('un día sin ventanas está cerrado', () => {
    expect(withinBusinessHours(bh, TUE('12:00'))).toBe(false);
  });

  it('no desborda al día siguiente', () => {
    expect(withinBusinessHours(bh, TUE('01:00'))).toBe(false);
  });
});

describe('withinBusinessHours — turno noche que cruza medianoche', () => {
  // Sólo el lunes tiene ventana: 22:00 del lunes → 02:00 del martes.
  const bh = hours({ 1: ['22:00-02:00'] });

  it('la noche del propio día', () => {
    expect(withinBusinessHours(bh, MON('22:30'))).toBe(true);
  });

  it('justo al abrir', () => {
    expect(withinBusinessHours(bh, MON('22:00'))).toBe(true);
  });

  it('sigue abierto pasada la medianoche, ya en el día siguiente', () => {
    expect(withinBusinessHours(bh, TUE('00:30'))).toBe(true);
    expect(withinBusinessHours(bh, TUE('01:59'))).toBe(true);
  });

  it('cierra a la hora de fin del día siguiente', () => {
    expect(withinBusinessHours(bh, TUE('02:00'))).toBe(false);
  });

  it('la tarde del día de inicio sigue cerrada', () => {
    expect(withinBusinessHours(bh, MON('15:00'))).toBe(false);
  });

  it('la madrugada del propio lunes NO abre (esa cola es del domingo)', () => {
    expect(withinBusinessHours(bh, MON('01:00'))).toBe(false);
  });
});

describe('withinBusinessHours — casos borde', () => {
  it('sin horario configurado responde siempre (24/7)', () => {
    expect(withinBusinessHours(null, MON('03:00'))).toBe(true);
  });

  it('un dato roto no debe callar al agente', () => {
    expect(
      withinBusinessHours({ timezone: 'No/Existe', windows: { 1: ['09:00-18:00'] } } as BusinessHours, MON('12:00')),
    ).toBe(true);
  });

  it('ventana malformada no matchea', () => {
    expect(withinBusinessHours(hours({ 1: ['nada'] }), MON('12:00'))).toBe(false);
  });

  it('varias ventanas el mismo día (turno partido)', () => {
    const bh = hours({ 1: ['09:00-13:00', '15:00-19:00'] });
    expect(withinBusinessHours(bh, MON('10:00'))).toBe(true);
    expect(withinBusinessHours(bh, MON('14:00'))).toBe(false);
    expect(withinBusinessHours(bh, MON('16:00'))).toBe(true);
  });

  it('24h expresado como 00:00-00:00 cubre todo el día', () => {
    const bh = hours({ 1: ['00:00-00:00'] });
    expect(withinBusinessHours(bh, MON('03:00'))).toBe(true);
    expect(withinBusinessHours(bh, MON('23:00'))).toBe(true);
  });
});

describe('containsEscalationKeyword', () => {
  it('detecta la palabra sin importar mayúsculas', () => {
    expect(containsEscalationKeyword(['humano'], 'Quiero hablar con un HUMANO')).toBe(true);
  });

  it('sin palabras configuradas no escala', () => {
    expect(containsEscalationKeyword([], 'humano')).toBe(false);
    expect(containsEscalationKeyword(null, 'humano')).toBe(false);
  });

  it('texto vacío no escala', () => {
    expect(containsEscalationKeyword(['humano'], '')).toBe(false);
  });

  it('no matchea si la palabra no está', () => {
    expect(containsEscalationKeyword(['reembolso'], '¿Cuánto cuesta?')).toBe(false);
  });
});
