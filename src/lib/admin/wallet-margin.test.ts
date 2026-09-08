import { describe, expect, it } from 'vitest';
import { summarizeWalletMargin } from './wallet-margin';

describe('summarizeWalletMargin', () => {
  it('includes fractional carry when checking zero margin', () => {
    const result = summarizeWalletMargin(
      [
        {
          proveedor: 'anthropic',
          movimientos: '2',
          costo_centavos: '1.75',
          cobrado_centavos: '1',
          ultimo_movimiento: null,
        },
      ],
      [],
      [{ resto_costo_centavos: '0.75' }]
    );
    expect(result.costoVariableUsd).toBe(0.0175);
    expect(result.cobradoUsd).toBe(0.01);
    expect(result.diferenciaUsd).toBeCloseTo(0);
  });

  it('reports pending reservations separately', () => {
    const result = summarizeWalletMargin(
      [],
      [
        {
          id: 'x',
          workspace_id: 'w',
          concepto: 'voz',
          proveedor: 'deepgram',
          reserva_centavos: 25,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      [],
      new Date('2026-01-01T00:16:00Z').getTime()
    );
    expect(result.reservasUsd).toBe(0.25);
    expect(result.pendientes).toBe(1);
    expect(result.pendientesVencidas).toBe(1);
    expect(result.pendienteMasAntigua).toBe('2026-01-01T00:00:00Z');
  });
});
