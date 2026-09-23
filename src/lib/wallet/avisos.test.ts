import { describe, expect, it } from 'vitest';
import { estadoDelAvisoDeSaldo } from './avisos';

const base = {
  saldo_centavos: 233,
  auto_umbral_centavos: 500,
  auto_recarga_centavos: 2500,
  stripe_payment_method_id: 'pm_1',
  auto_fallos: 0,
};

describe('avisos de saldo y recarga automática', () => {
  it('no avisa si la recarga automática todavía no falló', () => {
    expect(estadoDelAvisoDeSaldo(base)).toBe('ninguno');
  });

  it('avisa únicamente después de un fallo que dejó el saldo bajo', () => {
    expect(estadoDelAvisoDeSaldo({ ...base, auto_fallos: 1 })).toBe(
      'auto_fallida'
    );
    expect(
      estadoDelAvisoDeSaldo({ ...base, saldo_centavos: 3000, auto_fallos: 1 })
    ).toBe('ninguno');
  });

  it('mantiene el aviso normal cuando no hay recarga automática', () => {
    expect(
      estadoDelAvisoDeSaldo({
        ...base,
        auto_recarga_centavos: null,
        stripe_payment_method_id: null,
      })
    ).toBe('saldo_bajo');
  });
});
