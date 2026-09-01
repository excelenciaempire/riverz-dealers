import { describe, expect, it } from 'vitest'

import {
  asksForPrice,
  authorizedPrices,
  unauthorizedQuotedPrices,
  withoutHistoricalPriceLines,
} from './price-integrity'

const product = {
  price_min: 39990,
  price_max: 109990,
  allowed_offers: [
    { label: '1 Unidad', total: 39990 },
    { label: '3 Unidades', total: '69.990' },
    { label: '4 Unidades', total: 109990 },
  ],
}

describe('integridad de precios', () => {
  it('reconoce preguntas de precio en ambos idiomas', () => {
    expect(asksForPrice('Precio?')).toBe(true)
    expect(asksForPrice('How much does it cost?')).toBe(true)
    expect(asksForPrice('¿Cómo se usa?')).toBe(false)
  })

  it('arma la lista autorizada desde el precio y las ofertas', () => {
    expect(authorizedPrices([product])).toEqual(expect.arrayContaining([39990, 69990, 109990]))
  })

  it('deja pasar únicamente importes vigentes', () => {
    expect(
      unauthorizedQuotedPrices('Sale $39.990. El pack cuesta 69.990 ARS.', [product]),
    ).toEqual([])
    expect(unauthorizedQuotedPrices('El pack cuesta $99.900.', [product])).toEqual([99900])
  })

  it('bloquea también los fragmentos desnudos del incidente', () => {
    expect(
      unauthorizedQuotedPrices('Hola! 990 una unidad. 900. 900.', [product], {
        priceQuestion: true,
      }),
    ).toEqual(expect.arrayContaining([990, 900]))
  })

  it('no confunde cantidades de unidades con dinero', () => {
    expect(
      unauthorizedQuotedPrices('Puedes llevar 3 unidades o 4 unidades.', [product], {
        priceQuestion: true,
      }),
    ).toEqual([])
  })

  it('quita precios históricos del material pero conserva el conocimiento', () => {
    expect(
      withoutHistoricalPriceLines(
        'Modo de uso: dos gotas.\nPrecio: $99.900 ARS.\nApto para piel sensible.',
      ),
    ).toBe('Modo de uso: dos gotas.\nApto para piel sensible.')
  })
})
