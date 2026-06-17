import { describe, it, expect } from 'vitest';
import { orderUsedCode, computeIncrementality } from './attribution';

describe('orderUsedCode', () => {
  it('matchea el código de la campaña sin importar mayúsculas/espacios', () => {
    expect(orderUsedCode({ discount_codes: [{ code: 'JUNIO10' }] }, 'junio10')).toBe(true);
    expect(orderUsedCode({ discount_codes: [{ code: ' junio10 ' }] }, 'JUNIO10')).toBe(true);
  });

  it('es false si la orden usó otro código o ninguno', () => {
    expect(orderUsedCode({ discount_codes: [{ code: 'OTRO' }] }, 'JUNIO10')).toBe(false);
    expect(orderUsedCode({ discount_codes: [] }, 'JUNIO10')).toBe(false);
    expect(orderUsedCode({}, 'JUNIO10')).toBe(false);
  });

  it('es false si la campaña no tiene código', () => {
    expect(orderUsedCode({ discount_codes: [{ code: 'X' }] }, null)).toBe(false);
    expect(orderUsedCode({ discount_codes: [{ code: 'X' }] }, '')).toBe(false);
  });
});

describe('computeIncrementality', () => {
  it('resta el baseline del control para el revenue incremental', () => {
    // Control: 10% compra orgánica. Tratado: 100 personas, 30 conversiones.
    // Baseline esperado = 100 * 0.10 = 10 → incrementales = 20.
    const r = computeIncrementality({
      treatmentSize: 100,
      treatmentConversions: 30,
      treatmentRevenue: 3000,
      controlSize: 100,
      controlConversions: 10,
    });
    expect(r.incremental_conversions).toBe(20);
    expect(r.incremental_revenue).toBe(2000); // 3000 * (20/30)
    expect(r.uplift_pct).toBe(200); // 0.30 / 0.10 - 1 = 2x
  });

  it('sin control no resta baseline (conservador: todo es incremental)', () => {
    const r = computeIncrementality({
      treatmentSize: 50,
      treatmentConversions: 5,
      treatmentRevenue: 500,
      controlSize: 0,
      controlConversions: 0,
    });
    expect(r.incremental_conversions).toBe(5);
    expect(r.incremental_revenue).toBe(500);
    expect(r.uplift_pct).toBe(0);
  });

  it('nunca devuelve incrementales negativos', () => {
    // El control compra MÁS que el tratado → incremental 0, no negativo.
    const r = computeIncrementality({
      treatmentSize: 100,
      treatmentConversions: 5,
      treatmentRevenue: 500,
      controlSize: 100,
      controlConversions: 20,
    });
    expect(r.incremental_conversions).toBe(0);
    expect(r.incremental_revenue).toBe(0);
  });
});
