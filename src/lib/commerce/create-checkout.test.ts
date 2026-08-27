import { describe, it, expect } from 'vitest'
import { armarLinkDeCompra, marcarLink, leerMarca } from './create-checkout'

/**
 * Un comercio de Tiendanube o WooCommerce tenía un agente que conversaba,
 * recomendaba y NO podía vender: `create_checkout` estaba atado a Shopify, así
 * que llegaba a "te paso el link" y ahí se terminaba.
 *
 * Los formatos salen de tiendas reales, medidos el 2026-08-26 — no de un blog.
 */

const TN = { platform: 'tiendanube', shopDomain: 'riverzdemo.mitiendanube.com' }
const WOO = { platform: 'woocommerce', shopDomain: 'tienda.com', storeUrl: 'https://tienda.com' }

describe('el link de compra', () => {
  it('en WooCommerce lleva derecho a pagar', () => {
    // Quien ya dijo que lo quiere no tiene que volver a decirlo en el carrito.
    const l = armarLinkDeCompra({ tienda: WOO, id: '4821', cantidad: 2 })!
    expect(l.url).toBe('https://tienda.com/checkout/?add-to-cart=4821&quantity=2')
    expect(l.cargaSola).toBe(true)
    expect(l.carrito).toEqual({ plataforma: 'woocommerce', id: '4821', cantidad: 2 })
  })

  it('en Tiendanube manda la ficha del producto, no un carrito que no existe', () => {
    // Su carrito sólo se carga por POST: el mismo pedido por GET devuelve el
    // carrito vacío (medido, total $0). Prometer "ya te lo dejé en el carrito"
    // con un link así es mentirle a la clienta.
    const l = armarLinkDeCompra({
      tienda: TN,
      id: '357963740',
      cantidad: 1,
      productUrl: 'https://riverzdemo.mitiendanube.com/productos/serum/',
    })!
    expect(l.url).toContain('/productos/serum/')
    expect(l.cargaSola).toBe(false)
    expect(l.carrito).toEqual({ plataforma: 'tiendanube', id: '357963740', cantidad: 1 })
  })

  it('la marca viaja en el link y sobrevive a WhatsApp', () => {
    // La tienda ignora un parámetro que no conoce y muestra el producto igual;
    // el chat lo lee y ahí sí carga el carrito.
    const url = marcarLink('https://t.com/productos/x/', {
      plataforma: 'tiendanube',
      id: '99',
      cantidad: 3,
    })
    expect(url).toBe('https://t.com/productos/x/?riverz_cart=tn:99:3')
    expect(leerMarca(url)).toEqual({ plataforma: 'tiendanube', id: '99', cantidad: 3 })
  })

  it('respeta la query que el link ya traía', () => {
    const url = marcarLink('https://t.com/p?variant=7', {
      plataforma: 'woocommerce',
      id: '5',
      cantidad: 1,
    })
    expect(url).toBe('https://t.com/p?variant=7&riverz_cart=wc:5:1')
  })

  it('sin tienda o sin producto no inventa un link', () => {
    expect(armarLinkDeCompra({ tienda: { platform: 'tiendanube', shopDomain: '' }, id: '1' })).toBeNull()
    expect(armarLinkDeCompra({ tienda: TN, id: '' })).toBeNull()
    // Shopify no pasa por acá: tiene su propio armador, probado aparte.
    expect(armarLinkDeCompra({ tienda: { platform: 'shopify', shopDomain: 'x.myshopify.com' }, id: '1' })).toBeNull()
  })

  it('la cantidad nunca baja de uno', () => {
    expect(armarLinkDeCompra({ tienda: WOO, id: '1', cantidad: 0 })!.url).toContain('quantity=1')
    expect(armarLinkDeCompra({ tienda: WOO, id: '1', cantidad: -5 })!.url).toContain('quantity=1')
  })

  it('un link cualquiera no se confunde con un carrito', () => {
    expect(leerMarca('https://t.com/productos/x/')).toBeNull()
    expect(leerMarca('https://t.com/?riverz_cart=basura')).toBeNull()
  })
})
