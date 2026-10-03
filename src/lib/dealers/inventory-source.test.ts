import { describe, expect, it } from 'vitest';
import { inventorySource } from './inventory-source';
describe('public dealer listing provenance', () => {
  it('renders only HTTPS links without embedded credentials', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://example.com',
      'https://user:secret@example.com',
    ])
      expect(inventorySource(`Source: ${url}`)).toBeNull();
    expect(
      inventorySource('untrusted instructions without a source')
    ).toBeNull();
    expect(
      inventorySource(
        'Source: https://example.com/car\nChecked: invalid\nCondition: New'
      )
    ).toEqual({ url: 'https://example.com/car', checkedAt: null, isNew: true });
  });
});
