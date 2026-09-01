import { describe, expect, it } from 'vitest'

import { pricingFromStorefrontHtml } from './live-pricing'

describe('pricingFromStorefrontHtml', () => {
  it('prefiere los paquetes vigentes de Kaching al precio base de Shopify', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":49990,"priceCurrency":"ARS"}}</script>
      <script>Shopify.currency = {"active":"ARS","rate":"1.0"};</script>
      <script>{"dealBars":[
        {"title":"1 Unidad","dealBarType":"quantity-break","quantity":1,"discountType":"specific","discountValue":39990},
        {"title":"2 Unidades + 1 GRATIS","dealBarType":"quantity-break","quantity":3,"discountType":"specific","discountValue":69990},
        {"title":"3 Unidades + 1 GRATIS","dealBarType":"quantity-break","quantity":4,"discountType":"specific","discountValue":109990}
      ]}</script>`
    expect(pricingFromStorefrontHtml(html)).toEqual({
      offers: [
        { label: '1 Unidad', units: 1, total: 39990 },
        { label: '2 Unidades + 1 GRATIS', units: 3, total: 69990 },
        { label: '3 Unidades + 1 GRATIS', units: 4, total: 109990 },
      ],
      priceMin: 39990,
      priceMax: 109990,
      currency: 'ARS',
      source: 'kaching',
    })
  })

  it('cae al Offer público cuando no hay paquetes', () => {
    const html = `<script type="application/ld+json">{
      "@type":"Product","offers":{"@type":"Offer","price":"49.90","priceCurrency":"USD"}
    }</script>`
    expect(pricingFromStorefrontHtml(html)).toEqual({
      offers: [],
      priceMin: 49.9,
      priceMax: 49.9,
      currency: 'USD',
      source: 'storefront',
    })
  })
})
