import { describe, expect, it } from 'vitest';
import { esCoexistencia, esPinDistinto, necesitaRegistro, pinNuevo } from './registro';

describe('esCoexistencia', () => {
  it('manda lo que dice Meta del número', () => {
    expect(esCoexistencia({ is_on_biz_app: true }, 'nuevo')).toBe(true);
    expect(esCoexistencia({ is_on_biz_app: false }, 'coexistencia')).toBe(false);
    expect(esCoexistencia({ platform_type: 'SMB_APP' }, 'nuevo')).toBe(true);
  });

  it('si Meta no lo dice, usa el evento del popup', () => {
    expect(esCoexistencia(null, 'nuevo')).toBe(false);
    expect(esCoexistencia({}, 'nuevo')).toBe(false);
    expect(esCoexistencia(null, 'coexistencia')).toBe(true);
  });

  it('sin ninguna señal asume coexistencia (no registrar a ciegas)', () => {
    expect(esCoexistencia(null)).toBe(true);
    expect(esCoexistencia({})).toBe(true);
  });
});

describe('necesitaRegistro', () => {
  it('nunca en coexistencia', () => {
    expect(necesitaRegistro(true, 'NOT_APPLICABLE')).toBe(false);
  });
  it('un número propio que no está en Cloud API sí', () => {
    expect(necesitaRegistro(false, 'NOT_APPLICABLE')).toBe(true);
    expect(necesitaRegistro(false, undefined)).toBe(true);
  });
  it('un número propio que ya está en Cloud API no', () => {
    expect(necesitaRegistro(false, 'CLOUD_API')).toBe(false);
  });
});

describe('pin', () => {
  it('seis dígitos', () => {
    for (let i = 0; i < 50; i++) expect(pinNuevo()).toMatch(/^\d{6}$/);
  });
  it('reconoce el PIN distinto', () => {
    expect(esPinDistinto('{"error":{"code":133005,"message":"Two step verification PIN Mismatch"}}')).toBe(true);
    expect(esPinDistinto('{"error":{"code":131000}}')).toBe(false);
  });
});
