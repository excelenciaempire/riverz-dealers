import { describe, it, expect } from 'vitest'
import { rearmar } from './rearmar-carrito'

/**
 * Cambiar el talle o la cantidad tiene que costar un toque, no dos turnos de
 * chat. Antes la tarjeta mostraba lo que el modelo había elegido y punto: para
 * llevar dos había que escribirlo y esperar que armara otro enlace.
 */
describe('rearmar el carrito desde la tarjeta', () => {
  it('Shopify: cambia variante y cantidad', () => {
    const r = rearmar('https://t.myshopify.com/cart/111:1?attributes[a]=b', {
      variantId: '222',
      cantidad: 3,
    })!
    expect(r.path).toBe('/cart/222:3?attributes[a]=b')
    expect(r.href).toBe('https://t.myshopify.com/cart/222:3?attributes[a]=b')
  })

  it('Shopify: conserva los atributos de atribución', () => {
    // Ahí viaja el id del visitante hasta el pedido: perderlo es perder la
    // venta atribuida a la conversación.
    const r = rearmar('https://t.com/cart/111:1?attributes[riverz_wvid]=wv_9', { cantidad: 2 })!
    expect(r.path).toContain('attributes[riverz_wvid]=wv_9')
  })

  it('Tiendanube: reescribe la marca', () => {
    const r = rearmar('https://t.mitiendanube.com/productos/x/?riverz_cart=tn:357:1', {
      cantidad: 4,
    })!
    expect(r.path).toBe('/productos/x/?riverz_cart=tn:357:4')
  })

  it('WooCommerce: cambia el id y la cantidad', () => {
    const r = rearmar('https://t.com/checkout/?add-to-cart=48&quantity=1', {
      variantId: '99',
      cantidad: 2,
    })!
    expect(r.path).toBe('/checkout/?add-to-cart=99&quantity=2')
  })

  it('WooCommerce: agrega la cantidad si el enlace no la traía', () => {
    const r = rearmar('https://t.com/?add-to-cart=48', { cantidad: 5 })!
    expect(r.path).toBe('/?add-to-cart=48&quantity=5')
  })

  it('sin variante nueva deja la que estaba', () => {
    expect(rearmar('https://t.com/cart/111:1', { cantidad: 2 })!.path).toBe('/cart/111:2')
  })

  it('la cantidad nunca baja de uno', () => {
    expect(rearmar('https://t.com/cart/111:5', { cantidad: 0 })!.path).toBe('/cart/111:1')
  })

  it('con varios productos no se toca', () => {
    // Ahí "la cantidad" no significa nada, y adivinar cuál mover es peor que
    // no ofrecer el control.
    expect(rearmar('https://t.com/cart/111:1,222:2', { cantidad: 3 })).toBeNull()
  })

  it('un enlace que no es de compra devuelve null', () => {
    expect(rearmar('https://t.com/productos/x/', { cantidad: 2 })).toBeNull()
    expect(rearmar('no-es-una-url', { cantidad: 2 })).toBeNull()
  })

  it('una variante inventada no entra en el enlace', () => {
    // El id sale de la respuesta del servidor, pero el enlace termina en la
    // tienda: sólo dígitos.
    const r = rearmar('https://t.com/cart/111:1', { variantId: "1'; drop--", cantidad: 1 })!
    expect(r.path).toBe('/cart/111:1')
  })
})
