import { describe, expect, it } from 'vitest';
import { formatPrice } from './format';

describe('catalog prices reported by Tiendanube reviewers', () => {
  it.each([179.9, 33.72])('preserves the store price %s in Spanish and English', (amount) => {
    expect(formatPrice(amount, 'BRL', null, 'es')).toBe(
      new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'BRL' }).format(amount),
    );
    expect(formatPrice(amount, 'BRL', null, 'en')).toBe(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BRL' }).format(amount),
    );
  });
  it('uses the workspace currency without discarding cents', () => {
    expect(formatPrice(33.72, null, 'USD', 'en')).toBe('$33.72');
  });
  it('keeps fractional values when no currency is known', () => {
    expect(formatPrice(33.725, null, null, 'en')).toBe('33.725');
  });
  it('honors currencies with three minor digits', () => {
    expect(formatPrice(1.234, 'KWD', null, 'en')).toContain('1.234');
  });
  it('keeps missing and invalid currency fallbacks safe', () => {
    expect(formatPrice(null, 'BRL')).toBe('—');
    expect(formatPrice(33.72, 'invalid')).toBe('33.72');
  });
});
