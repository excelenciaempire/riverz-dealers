import { describe, expect, it } from 'vitest';
import { dealerQuoteNotes } from './quote-notes';
describe('dealer supplementary monetary notes', () => {
  it('keeps vehicle facts and source notes while withholding unstructured fees and offers from AI quotes', () => {
    const notes =
      '2026 Toyota Camry. 12000 mi. Source: https://example.com/car\nCyber Price excludes tax and tag; $999.50 doc fee included. Financing from USD 499.00 monthly; 200 EUR discount.';
    const result = dealerQuoteNotes(notes);
    expect(result).toContain(
      '2026 Toyota Camry. 12000 mi. Source: https://example.com/car'
    );
    expect(result).not.toMatch(/999\.50|499\.00|200 EUR/);
    expect(notes).toContain('$999.50');
    expect(
      dealerQuoteNotes(
        'Precio por confirmar. Motor 2.5L; millaje no publicado.'
      )
    ).toBe('Precio por confirmar. Motor 2.5L; millaje no publicado.');
  });
});
