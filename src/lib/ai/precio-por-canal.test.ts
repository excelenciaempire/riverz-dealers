import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { lineaDeCanales, formatProductLine, type ProductRow } from './runner'

/**
 * El precio de cada canal tiene que llegar al prompt SIEMPRE.
 *
 * La unificación calculaba los precios de las dos plataformas y el prompt sólo
 * los mostraba en la línea de catálogo — que se arma únicamente cuando el
 * producto NO tiene ficha compilada. O sea que justo los productos que el
 * comercio se tomó el trabajo de llenar llegaban con toda su investigación y
 * sin el precio del marketplace, y el agente le cotizaba el de la tienda a
 * quien le escribía desde ahí. Medido el 2026-08-25.
 */

const SERUM: ProductRow = {
  id: 'shop',
  title: 'Serum',
  price_min: 29,
  price_max: 29,
  currency: 'USD',
  listings: [
    { platform: 'shopify', price: 29, currency: 'USD', units: 1, url: null },
    { platform: 'mercadolibre', price: 52, currency: 'USD', units: 2, url: null },
  ],
}

describe('el precio de cada canal', () => {
  it('nombra el canal, el precio y cuántas unidades entran', () => {
    const l = lineaDeCanales(SERUM)
    expect(l).toContain('shopify 29 USD')
    // Las unidades importan: en un marketplace el x2 es una publicación aparte,
    // y sin esto el agente lee 52 como el precio de un frasco.
    expect(l).toContain('mercadolibre 2u 52 USD')
  })

  it('sin moneda no arriesga un precio', () => {
    // "$39990" al lado de "$45000 ARS" se lee como el mismo orden de magnitud,
    // y ahí el modelo le cotiza pesos argentinos a un cliente colombiano.
    const sinMoneda = {
      ...SERUM,
      listings: SERUM.listings!.map((l) => ({ ...l, currency: null })),
    }
    const l = lineaDeCanales(sinMoneda)
    expect(l).toContain('también se vende en')
    expect(l).not.toContain('52')
  })

  it('un producto de un solo canal no lleva la línea', () => {
    expect(lineaDeCanales({ id: 'x', title: 'Solo' })).toBe('')
    expect(lineaDeCanales({ ...SERUM, listings: [SERUM.listings![0]] })).toBe('')
  })

  it('la línea de catálogo sigue llevándola', () => {
    expect(formatProductLine(SERUM)).toContain('precio por canal')
  })

  it('y el bloque de conocimiento del producto también', () => {
    // Es el que se usa cuando SÍ hay ficha compilada, que es el caso normal de
    // un producto trabajado. Ahí era donde el precio no llegaba.
    const runner = readFileSync('src/lib/ai/runner.ts', 'utf8')
    const bloque = runner.slice(runner.indexOf('const tmRaw'), runner.indexOf('</product_knowledge>'))
    expect(bloque).toContain('lineaDeCanales')
  })
})
