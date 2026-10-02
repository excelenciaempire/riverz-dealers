import { describe, it, expect } from 'vitest';
import { dealerQuoteText } from './quote-text';
import { unauthorizedQuotedPrices } from '@/lib/products/price-integrity';
const q = [{ id: 'test', price: 20000, currency: 'USD', year: 2022 }];
const invalid = (text: string) =>
  unauthorizedQuotedPrices(
    dealerQuoteText(text, 'Busco un carro de hasta 21000 USD', q),
    [20000],
    { priceQuestion: true }
  );
describe('dealer monetary context', () => {
  it('distinguishes live vehicle specifications and buyer budget from a selling price', () => {
    expect(
      invalid(
        'Para tu presupuesto de 21000 USD tenemos Toyota Camry 2022, 22000 millas, por $20000.'
      )
    ).toEqual([]);
    expect(
      invalid(
        'Your budget is $21000. Toyota Camry 2022 with 22000 miles costs $20000.'
      )
    ).toEqual([]);
  });
  it('still blocks invented prices even when they match the buyer budget, year or mileage', () => {
    expect(
      invalid('Tu presupuesto de $21000. El Camry cuesta $21000.')
    ).toEqual([21000]);
    expect(invalid('Camry cuesta 2022.')).toEqual([2022]);
    expect(invalid('Camry $2022 con 22000 millas.')).toEqual([2022]);
    expect(invalid('Camry cuesta $22000.')).toEqual([22000]);
    expect(invalid('Tu presupuesto de $19000.')).toEqual([19000]);
  });
});
