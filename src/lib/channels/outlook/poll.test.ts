import { describe, expect, it } from 'vitest';
import { filtroOutlook } from './poll';

describe('filtroOutlook', () => {
  it('en vivo pide lo estrictamente posterior al cursor', () => {
    expect(filtroOutlook('receivedDateTime', '2026-09-25T00:00:00.000Z')).toBe(
      'receivedDateTime gt 2026-09-25T00:00:00.000Z',
    );
  });

  it('el historial es un tramo cerrado [desde, hasta)', () => {
    expect(
      filtroOutlook('sentDateTime', '2026-06-28T00:00:00.000Z', '2026-09-26T00:00:00.000Z'),
    ).toBe(
      'sentDateTime ge 2026-06-28T00:00:00.000Z and sentDateTime lt 2026-09-26T00:00:00.000Z',
    );
  });
});
