import { describe, it, expect } from 'vitest'
import { esDeQuienPregunta } from './order-lookup'

/**
 * El número de pedido no prueba de quién es el pedido.
 *
 * En Tiendanube y en WooCommerce son correlativos y chicos (1, 2, 3…), así que
 * quien escribiera al chat de la tienda podía pedir "el pedido 118" y recibir
 * el correo de la compradora, lo que compró, el total y el seguimiento — y
 * después 119, y 120. El camino de Shopify de la tool ya comparaba contra el
 * contacto; estos dos, y el nodo de flujo, devolvían el pedido sin mirar.
 */
describe('el pedido es de quien pregunta, o no se contesta', () => {
  it('acepta cuando coincide el correo', () => {
    expect(
      esDeQuienPregunta({ correos: ['Ana@Example.com'] }, { email: 'ana@example.com' }),
    ).toBe(true)
  })

  it('acepta cuando coincide el teléfono, aunque cambie el formato', () => {
    // El mismo número escrito de cuatro formas. Se comparan los últimos ocho
    // dígitos porque el prefijo de país y el 9 de Argentina no son estables.
    expect(esDeQuienPregunta({ telefonos: ['+57 310 555 4433'] }, { phone: '3105554433' })).toBe(true)
    expect(esDeQuienPregunta({ telefonos: ['5491155554433'] }, { phone: '541155554433' })).toBe(true)
  })

  it('rechaza el pedido de otra persona', () => {
    expect(
      esDeQuienPregunta(
        { correos: ['otra@example.com'], telefonos: ['+57 320 111 2233'] },
        { email: 'ana@example.com', phone: '3105554433' },
      ),
    ).toBe(false)
  })

  it('sin nada con qué comparar, rechaza', () => {
    // Es el caso del chat web sin identificar. Se rechaza a propósito: el
    // pedido legítimo de esa persona se contesta con la fila espejo, que está
    // atada a la conversación y no depende de adivinar un número.
    expect(esDeQuienPregunta({ correos: ['ana@example.com'] }, undefined)).toBe(false)
    expect(esDeQuienPregunta({ correos: ['ana@example.com'] }, {})).toBe(false)
    expect(esDeQuienPregunta({ correos: ['ana@example.com'] }, { email: '', phone: '' })).toBe(false)
  })

  it('un teléfono demasiado corto no alcanza para dar por suyo un pedido', () => {
    expect(esDeQuienPregunta({ telefonos: ['4433'] }, { phone: '4433' })).toBe(false)
  })
})
