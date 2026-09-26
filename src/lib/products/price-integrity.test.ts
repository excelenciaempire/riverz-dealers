import { describe, expect, it } from 'vitest'

import {
  asksForPrice,
  asksForCurrentOffer,
  authorizedPrices,
  montosDeReglas,
  replyForUnidentifiedPrice,
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
  it.each(['99.900 COP', '$99,900', '99.900', '129.900 COP', '$1.299.900'])('no extrae fragmentos de %s', (text) => {
    expect(unauthorizedQuotedPrices(text, [99900, 129900, 1299900], { priceQuestion: true })).toEqual([])
  })

  it('sigue bloqueando un importe no autorizado junto a uno válido', () => {
    expect(unauthorizedQuotedPrices('99.900 COP. Otro cuesta 900.', [99900], { priceQuestion: true })).toEqual([900])
  })

  it('reconoce preguntas de precio en ambos idiomas', () => {
    expect(asksForPrice('Precio?')).toBe(true)
    expect(asksForPrice('How much does it cost?')).toBe(true)
    expect(asksForPrice('¿Cómo se usa?')).toBe(false)
  })

  it.each(['¿Cuál es la oferta?', '¿Cómo funciona el 2x1?', '¿El segundo par es gratis?', 'Pague uno lleve dos'])('refreshes current commercial terms for %s', (text) => {
    expect(asksForCurrentOffer(text)).toBe(true)
  })

  it('arma la lista autorizada desde el precio y las ofertas', () => {
    expect(authorizedPrices([product])).toEqual(expect.arrayContaining([39990, 69990, 109990]))
  })

  it('autoriza el precio de cada canal donde se publica lo mismo', () => {
    const conCanales = {
      ...product,
      listings: [
        { price: 39990 },
        { price: '81990' },
        { price: null },
      ],
    }
    expect(unauthorizedQuotedPrices('En Mercado Libre sale $81.990.', [conCanales])).toEqual([])
    expect(unauthorizedQuotedPrices('En Mercado Libre sale $81.990.', [product])).toEqual([81990])
  })

  it('toma como propios los importes que el comercio escribió en sus reglas', () => {
    const montos = montosDeReglas([
      { cuando: 'Preguntan por el envío', hacer: 'A sucursal es gratis y a domicilio cuesta $1.990.' },
      { cuando: null, hacer: 'Por transferencia, 4 meses con envío a domicilio: $63.980 en total. Son 3 cuotas.' },
    ])
    expect(montos).toEqual(expect.arrayContaining([1990, 63980]))
    expect(montos).not.toContain(3)
    expect(unauthorizedQuotedPrices('A domicilio suma $1.990.', [...authorizedPrices([product]), ...montos])).toEqual([])
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

  it('recupera una pregunta de precio sin producto sin inventar un importe', () => {
    const reply = replyForUnidentifiedPrice('es', ['https://rasmiaw.shop/products/bolirasmiaw'])
    expect(reply).toContain('cuál modelo')
    expect(reply).toContain('https://rasmiaw.shop')
    expect(reply).not.toMatch(/\d{3,}/)
  })
})
