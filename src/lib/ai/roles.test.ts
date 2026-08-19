import { describe, it, expect } from 'vitest'

import { agentCan, pickByRole, roleForInbound } from './roles'

/**
 * El arbitraje entre agentes y los permisos por acción.
 *
 * Lo que más importa acá no es que la flota funcione: es que las cuentas que ya
 * existen —un agente por canal, `permissions` en NULL— se comporten exactamente
 * como antes. La migración 164 no cambia nada para ellas, y esto lo fija.
 */

describe('agentCan', () => {
  it('sin permissions, crear pedidos sigue mandando la columna vieja', () => {
    expect(agentCan({ puede_crear_pedidos: true }, 'crear_pedidos')).toBe(true)
    expect(agentCan({ puede_crear_pedidos: false }, 'crear_pedidos')).toBe(false)
    expect(agentCan({}, 'crear_pedidos')).toBe(false)
  })

  it('sin permissions, el resto queda permitido como antes', () => {
    // Antes de la 164 estas acciones sólo dependían de la infraestructura (si
    // había Shopify, si había teléfono). Negarlas al migrar habría apagado
    // capacidades en agentes que venían funcionando.
    expect(agentCan({}, 'crear_checkout')).toBe(true)
    expect(agentCan({}, 'escalar_llamada')).toBe(true)
  })

  it('permissions explícito le gana a la columna vieja', () => {
    expect(
      agentCan({ permissions: { crear_pedidos: false }, puede_crear_pedidos: true }, 'crear_pedidos'),
    ).toBe(false)
    expect(
      agentCan({ permissions: { crear_pedidos: true }, puede_crear_pedidos: false }, 'crear_pedidos'),
    ).toBe(true)
  })

  it('una clave ausente dentro de permissions cae al respaldo', () => {
    expect(agentCan({ permissions: { crear_checkout: false } }, 'crear_pedidos')).toBe(false)
    expect(agentCan({ permissions: { crear_pedidos: true } }, 'escalar_llamada')).toBe(true)
  })
})

describe('roleForInbound', () => {
  it('un pedido va a postventa', () => {
    for (const t of [
      '¿dónde está mi pedido?',
      'todavía no me llegó el envío',
      'me pasás la guía de seguimiento?',
      'quiero hacer una devolución',
      'hola, mi orden #1042 está demorada',
    ]) {
      expect(roleForInbound(t), t).toBe('postventa')
    }
  })

  it('una consulta fría no fuerza rol', () => {
    expect(roleForInbound('hola, cuánto sale?')).toBeNull()
    expect(roleForInbound('tienen envío a Córdoba')).toBe('postventa')
  })

  it('recuperación sólo con algo sin terminar', () => {
    // Sin carrito abierto, "no pude pagar" es una consulta de ventas.
    expect(roleForInbound('no pude pagar con la tarjeta')).toBeNull()
    expect(roleForInbound('no pude pagar con la tarjeta', { hasOpenCart: true })).toBe(
      'recuperacion',
    )
  })

  it('postventa le gana a recuperación', () => {
    // Quien pregunta por un pedido que ya hizo no quiere que le vendan otra cosa.
    expect(roleForInbound('mi pedido no llegó y el pago fue rechazado', { hasOpenCart: true })).toBe(
      'postventa',
    )
  })
})

describe('pickByRole', () => {
  const ventas = { id: 'v', role: 'ventas' }
  const postventa = { id: 'p', role: 'postventa' }
  const general = { id: 'g', role: 'general' }

  it('con un solo candidato lo devuelve tal cual', () => {
    // Es el caso de TODAS las cuentas de hoy: el arbitraje ni se ejecuta.
    expect(pickByRole([general], 'postventa')).toBe(general)
  })

  it('elige el rol pedido cuando está', () => {
    expect(pickByRole([ventas, postventa], 'postventa')).toBe(postventa)
  })

  it('sin rol pedido atiende ventas', () => {
    expect(pickByRole([postventa, ventas], null)).toBe(ventas)
  })

  it('si nadie cubre el rol pedido, no deja la conversación sin atender', () => {
    expect(pickByRole([ventas, general], 'retencion')).toBe(ventas)
  })

  it('sin candidatos devuelve null', () => {
    expect(pickByRole([], 'ventas')).toBeNull()
  })
})
