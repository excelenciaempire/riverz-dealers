import { afterEach, expect, it, vi } from 'vitest';
import { walletDateRange } from './date-range';
afterEach(() => vi.useRealTimers());
it('uses merchant calendar days for today, yesterday and the last seven days', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T02:30:00Z'));
  expect(walletDateRange('America/Bogota', 0, '', '')).toEqual({
    desde: '2026-09-27T05:00:00.000Z',
    hasta: '2026-09-28T02:30:00.000Z',
  });
  expect(walletDateRange('America/Bogota', -1, '', '')).toEqual({
    desde: '2026-09-26T05:00:00.000Z',
    hasta: '2026-09-27T05:00:00.000Z',
  });
  expect(walletDateRange('America/Bogota', 7, '', '').desde).toBe(
    '2026-09-21T05:00:00.000Z'
  );
});
it('includes the whole final date with an exclusive midnight boundary, including DST and inverted dates', () => {
  const expected = {
    desde: '2026-03-08T05:00:00.000Z',
    hasta: '2026-03-09T04:00:00.000Z',
  };
  expect(
    walletDateRange('America/New_York', null, '2026-03-08', '2026-03-08')
  ).toEqual(expected);
  expect(
    walletDateRange('America/New_York', null, '2026-03-09', '2026-03-08')
  ).toEqual({ desde: expected.desde, hasta: '2026-03-10T04:00:00.000Z' });
});
it('keeps a valid range while a date field is cleared during editing', () => {
  expect(() => walletDateRange('UTC', null, '', '')).not.toThrow();
});
