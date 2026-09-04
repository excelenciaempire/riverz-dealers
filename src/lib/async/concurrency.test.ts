import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('procesa todas las cuentas, conserva el orden y respeta el límite', async () => {
    let active = 0;
    let peak = 0;
    const rows = Array.from({ length: 17 }, (_, index) => index);

    const result = await mapWithConcurrency(rows, 3, async (value) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value % 3));
      active--;
      return `cuenta-${value}`;
    });

    expect(peak).toBe(3);
    expect(result).toEqual(rows.map((value) => `cuenta-${value}`));
  });

  it('no inventa trabajo para una lista vacía', async () => {
    let calls = 0;
    await expect(
      mapWithConcurrency([], 2, async () => {
        calls++;
      })
    ).resolves.toEqual([]);
    expect(calls).toBe(0);
  });

  it('rechaza límites que podrían dejar cuentas sin procesar', async () => {
    await expect(
      mapWithConcurrency([1], 0, async (value) => value)
    ).rejects.toThrow(RangeError);
  });
});
