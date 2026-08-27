import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

/**
 * La tarjeta de compra tiene que aparecer en las TRES tiendas.
 *
 * El chat detecta el link de compra por su forma, y sólo conocía la de Shopify
 * (`/cart/id:cantidad`). En Tiendanube y WooCommerce el mismo mensaje mostraba
 * un enlace azul que sacaba a la persona de la conversación — que es
 * exactamente lo que la tarjeta existe para evitar.
 *
 * Se comprueba sobre el archivo porque el cargador es JavaScript suelto que
 * corre en la tienda, no un módulo que se pueda importar.
 */
describe('el carrito en las tres plataformas', () => {
  const cargador = readFileSync('public/widget/v1.js', 'utf8')
  const chat = readFileSync('src/components/webchat/message-text.tsx', 'utf8')

  it('el cargador reconoce la marca de Tiendanube y Woo', () => {
    expect(cargador).toContain('riverz_cart')
    expect(cargador).toContain('add-to-cart')
  })

  it('y sabe cómo carga el carrito cada una', () => {
    // Tiendanube: POST a /comprar/. Por GET contesta el carrito vacío.
    expect(cargador).toContain("'/comprar/'")
    expect(cargador).toContain('add_to_cart')
    // Shopify: su API de carrito.
    expect(cargador).toContain('/cart/add.js')
  })

  it('manda a la caja correcta de cada tienda', () => {
    // `/checkout` en Tiendanube es un 404: ahí la caja es /comprar/.
    const ir = cargador.slice(cargador.indexOf('function goCheckout'))
    expect(ir).toContain("'/comprar/'")
    expect(ir).toContain("'/checkout/'")
  })

  it('el chat dibuja la tarjeta con los tres formatos', () => {
    expect(chat).toContain('riverz_cart')
    expect(chat).toContain('add-to-cart')
    expect(chat).toContain('/cart/')
  })

  it('la herramienta del agente ya no exige Shopify', () => {
    const tools = readFileSync('src/lib/ai/tools.ts', 'utf8')
    const bloque = tools.slice(tools.indexOf("toolName === 'create_checkout'"))
    expect(bloque.slice(0, 2500)).toContain('armarLinkDeCompra')
    const runner = readFileSync('src/lib/ai/runner.ts', 'utf8')
    expect(runner).toContain("!shopify && otherStore && puede('crear_checkout')")
  })
})
