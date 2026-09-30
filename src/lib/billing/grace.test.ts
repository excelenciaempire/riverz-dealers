import { describe, expect, it, vi } from 'vitest';
import { resolvedGraceHours, validGraceHours } from './grace';
import { acceso } from './plan';
import type { Suscripcion } from './plan';
describe('merchant grace policy', () => {
  it.each([24,48,72,168,720])('accepts %s hours', hours => expect(validGraceHours(hours)).toBe(true));
  it.each([0,23,24.1,721,NaN,Infinity,'72',null])('rejects %s', hours => {
    expect(validGraceHours(hours)).toBe(false); expect(resolvedGraceHours(hours)).toBe(24);
  });
  it.each(['oficial','saldo','byok'] as const)('uses the same custom clock in %s', modeloCobro => {
    vi.useFakeTimers(); const start = Date.parse('2026-10-01T00:00:00Z');
    const s = { estado: 'vencida', vencidaDesde: new Date(start).toISOString(), graceHours: 72, modeloCobro } as Suscripcion;
    vi.setSystemTime(start + 48 * 3_600_000);
    expect(acceso(s)).toMatchObject({ puede: true, horasDeGracia: 24 });
    vi.setSystemTime(start + 72 * 3_600_000);
    expect(acceso(s)).toMatchObject({ puede: false, horasDeGracia: 0 });
    vi.useRealTimers();
  });
});
