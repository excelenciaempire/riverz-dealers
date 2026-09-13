import { describe, expect, it } from 'vitest';
import { retentionProductVars } from './retention-product';
describe('product-specific reorder quantities', () => {
  it('finds later lines and never counts another product', () => {
    expect(
      retentionProductVars(
        JSON.stringify([
          { title: 'Other', quantity: 9 },
          { title: 'Serum Pilar', quantity: 3 },
        ]),
        'Serum Pilar'
      )
    ).toEqual({ retention_product: 'Serum Pilar', retention_units: '3' });
  });
  it('sums only matching lines, ignoring case and surrounding spaces', () => {
    expect(
      retentionProductVars(
        JSON.stringify([
          { title: ' serum pilar ', quantity: 1 },
          { title: 'Serum Pilar', quantity: 3 },
        ]),
        'Serum Pilar'
      ).retention_units
    ).toBe('4');
  });
  it.each([null, 'bad', '{}', '[]', '[{"title":"Other","quantity":1}]'])(
    'rejects missing or nonmatching order data: %s',
    (raw) => {
      expect(retentionProductVars(raw, 'Serum Pilar')).toEqual({
        retention_product: '',
        retention_units: '',
      });
    }
  );
  it.each([0, -1, 1.5, null, true, 'bad', Number.MAX_SAFE_INTEGER + 1])(
    'does not guess an offer for quantity %s',
    (quantity) => {
      expect(
        retentionProductVars(
          JSON.stringify([{ title: 'Serum Pilar', quantity }]),
          'Serum Pilar'
        )
      ).toEqual({ retention_product: 'Serum Pilar', retention_units: '' });
    }
  );
});
