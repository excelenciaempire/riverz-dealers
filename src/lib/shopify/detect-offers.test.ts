import { describe, it, expect } from 'vitest'
import {
  parseMoney,
  offersFromText,
  offersFromOrderProperties,
  offersByProductFromOrder,
  offersFromKachingConfig,
  detectOffers,
  normalizeDetectedOffers,
  mergeOffers,
  synthesizeLabel,
} from './detect-offers'

describe('parseMoney', () => {
  it('parses LatAm grouping (dot thousands, comma decimals)', () => {
    expect(parseMoney('$69.900,00')).toBe(69900)
    expect(parseMoney('210.000,00')).toBe(210000)
  })
  it('parses en grouping (comma thousands, dot decimals)', () => {
    expect(parseMoney('39,990.00')).toBe(39990)
    expect(parseMoney('$1,299')).toBe(1299)
  })
  it('treats lone-dot 3-digit groups as thousands', () => {
    expect(parseMoney('39.990')).toBe(39990)
    expect(parseMoney('1.299.500')).toBe(1299500)
  })
  it('treats a lone dot with 1-2 decimals as a decimal', () => {
    expect(parseMoney('39.99')).toBe(39.99)
  })
  it('returns null for junk / zero', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('gratis')).toBeNull()
    expect(parseMoney(0)).toBeNull()
    expect(parseMoney(1500)).toBe(1500)
  })
})

describe('offersFromText — the real Kaching widget example', () => {
  // Roughly how Firecrawl markdown renders the widget the user shared.
  const md = `
¡Lleva más, paga menos!
¡Apúrate! La Oferta Termina en 14:58
1 Unidad Precio Promocional
$39.990,00 $70.000,00
ENVIO GRATIS + REGALO SORPRESA
2 Unidades + 1 GRATIS
AHORRAS $140.100,00
$69.900,00 $210.000,00
ENVIO GRATIS + REGALO SORPRESA
3 Unidades + 1 GRATIS
$99.900,00 $280.000,00
Comprar Ahora
`
  const offers = normalizeDetectedOffers(offersFromText(md), 'es')

  it('finds exactly the three tiers with correct TOTAL units (paid + free)', () => {
    expect(offers.map((o) => o.units)).toEqual([1, 3, 4])
  })
  it('keeps the human labels verbatim', () => {
    expect(offers.find((o) => o.units === 3)?.label).toMatch(/2 Unidades \+ 1 GRATIS/i)
    expect(offers.find((o) => o.units === 4)?.label).toMatch(/3 Unidades \+ 1 GRATIS/i)
  })
  it('takes the sale price (lowest money token), not compare-at or savings', () => {
    expect(offers.find((o) => o.units === 1)?.total).toBe(39990)
    expect(offers.find((o) => o.units === 3)?.total).toBe(69900)
    expect(offers.find((o) => o.units === 4)?.total).toBe(99900)
  })
  it('does not treat "ENVIO GRATIS" or the countdown as offers', () => {
    // Only 3 tiers — the free-shipping line and 14:58 timer are ignored.
    expect(offers).toHaveLength(3)
  })
})

describe('offersFromText — english + pack phrasings', () => {
  it('parses "Buy 2 get 1 free" style and "3-pack"', () => {
    const offers = normalizeDetectedOffers(
      offersFromText('2 units + 1 free — $50\n3 pack $70\npack de 4 $90'),
      'en',
    )
    expect(offers.map((o) => o.units)).toEqual([3, 4])
    // "2 units + 1 free" => 3; "3 pack" => 3 (deduped); "pack de 4" => 4
  })
  it('returns nothing for a plain single-price page', () => {
    expect(offersFromText('Serum facial 30ml. Precio: $45.000. Envío gratis.')).toEqual([])
  })
})

describe('offersFromOrderProperties — Kaching __kaching_bundles', () => {
  it('sums line quantities grouped by deal code (BXGY free line included)', () => {
    const order = {
      line_items: [
        { quantity: 3, properties: [{ name: '__kaching_bundles', value: '{"deal":"u1sI","main":true}' }] },
        { quantity: 1, properties: [{ name: '__kaching_bundles', value: '{"deal":"u1sI"}' }] },
      ],
    }
    expect(offersFromOrderProperties(order)).toEqual([{ label: '', units: 4 }])
  })
  it('quantity-break single line', () => {
    const order = {
      line_items: [
        { quantity: 3, properties: [{ name: '__kaching_bundles', value: '{"deal":"abc"}' }] },
      ],
    }
    expect(offersFromOrderProperties(order)).toEqual([{ label: '', units: 3 }])
  })
  it('ignores orders with no kaching property', () => {
    expect(offersFromOrderProperties({ line_items: [{ quantity: 2, properties: [] }] })).toEqual([])
  })
})

describe('offersFromKachingConfig — embedded page config (real store shape)', () => {
  // Mirrors the dealBars JSON pilarargentina.store embeds in the product page.
  const html = `<html><body><script>window.__kaching = {"blockTitle":"¡Lleva más, paga menos!","dealBars":[
    {"id":"MFN9","label":"Precio Promocional","title":"1 Unidad","quantity":1,"dealBarType":"quantity-break"},
    {"id":"Ab12","label":"Ahorra {{saved_total}}","title":"2  Unidades + 1 GRATIS","quantity":3,"dealBarType":"quantity-break"},
    {"id":"JGz6","label":"Ahorra {{saved_total}}","title":"3 Unidades + 1 GRATIS","quantity":4,"dealBarType":"quantity-break"}
  ]};</script></body></html>`

  it('extracts each tier with total units from quantity (render-independent)', () => {
    const offers = normalizeDetectedOffers(offersFromKachingConfig(html), 'es')
    expect(offers.map((o) => o.units)).toEqual([1, 3, 4])
    expect(offers.find((o) => o.units === 4)?.label).toMatch(/3 Unidades \+ 1 GRATIS/)
  })

  it('computes bxgy total as buy + get', () => {
    const bxgy = `x "dealBars":[{"title":"Compra 2 lleva 1","dealBarType":"bxgy","buyQuantity":2,"getQuantity":1}] y`
    expect(offersFromKachingConfig(bxgy)).toEqual([{ label: 'Compra 2 lleva 1', units: 3 }])
  })

  it('returns nothing when there is no dealBars config', () => {
    expect(offersFromKachingConfig('<html>no config here</html>')).toEqual([])
  })
})

describe('detectOffers — config (html) + widget text (markdown) merged', () => {
  it('takes clean units/labels from config and the price from the rendered text', () => {
    const html = `"dealBars":[{"title":"2 Unidades + 1 GRATIS","quantity":3,"dealBarType":"quantity-break"}]`
    const markdown = `2 Unidades + 1 GRATIS $69.900,00 $210.000,00`
    const offers = detectOffers(markdown, html, 'es')
    expect(offers).toHaveLength(1)
    expect(offers[0]).toEqual({ label: '2 Unidades + 1 GRATIS', units: 3, total: 69900 })
  })
})

describe('offersByProductFromOrder — attribute learned tiers to products', () => {
  it('sums a deal per product (quantity-break, single product)', () => {
    const order = {
      line_items: [
        { product_id: 111, quantity: 3, properties: [{ name: '__kaching_bundles', value: '{"deal":"d1"}' }] },
      ],
    }
    expect(offersByProductFromOrder(order)).toEqual([{ productId: '111', units: 3 }])
  })
  it('BXGY: qualifying + free line of the same product → units 4 on that product', () => {
    const order = {
      line_items: [
        { product_id: 222, quantity: 3, properties: [{ name: '__kaching_bundles', value: '{"deal":"d2","main":true}' }] },
        { product_id: 222, quantity: 1, properties: [{ name: '__kaching_bundles', value: '{"deal":"d2"}' }] },
      ],
    }
    expect(offersByProductFromOrder(order)).toEqual([{ productId: '222', units: 4 }])
  })
  it('ignores line items without the kaching property', () => {
    const order = { line_items: [{ product_id: 5, quantity: 2, properties: [] }] }
    expect(offersByProductFromOrder(order)).toEqual([])
  })
})

describe('normalizeDetectedOffers', () => {
  it('dedupes by units, fills labels, sorts ascending, drops invalid', () => {
    const out = normalizeDetectedOffers(
      [
        { label: '', units: 2 },
        { label: '2-pack promo', units: 2, total: 100 },
        { label: 'x', units: 0 },
        { label: 'y', units: -3 },
        { label: 'Trio', units: 3 },
      ],
      'es',
    )
    expect(out).toEqual([
      { label: '2-pack promo', units: 2, total: 100 },
      { label: 'Trio', units: 3 },
    ])
  })
})

describe('mergeOffers — append-only', () => {
  it('adds only tiers whose units are not already present', () => {
    const existing = [{ label: 'Uno', units: 1, total: 40 }]
    const { offers, added } = mergeOffers(existing, [
      { label: 'Uno detectado', units: 1 },
      { label: 'Tres', units: 3 },
    ])
    expect(added).toBe(1)
    expect(offers).toHaveLength(2)
    expect(offers[0]).toEqual({ label: 'Uno', units: 1, total: 40 })
    expect(offers[1]).toEqual({ label: 'Tres', units: 3 })
  })
})

describe('synthesizeLabel', () => {
  it('is bilingual + singular-aware', () => {
    expect(synthesizeLabel(1, 'es')).toBe('1 unidad')
    expect(synthesizeLabel(3, 'es')).toBe('3 unidades')
    expect(synthesizeLabel(1, 'en')).toBe('1 unit')
    expect(synthesizeLabel(4, 'en')).toBe('4 units')
  })
})
