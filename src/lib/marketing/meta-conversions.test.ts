import { describe, it, expect } from 'vitest'
import {
  armarEvento,
  correoNormalizado,
  telefonoNormalizado,
} from './meta-conversions'

/**
 * El evento que le cuenta a Meta una venta cerrada en el chat.
 *
 * Todo lo de acá decide si la venta se atribuye o se pierde. Un `fbp` hasheado,
 * un teléfono sin país o un `event_id` distinto al del píxel no fallan con un
 * error: fallan en silencio, y el comercio ve una campaña que "no convierte".
 */

const VENTA = {
  workspaceId: 'w1',
  orderId: '6722673148043',
  value: 69000,
  currency: 'cop',
  cliente: {
    email: '  Ana.Ruiz@Example.com ',
    phone: '+57 310 555 4433',
    nombre: 'Ana',
    apellido: 'Ruiz',
    ciudad: 'Bogotá',
  },
  senales: {
    fbp: 'fb.1.1717099212345.987654321',
    fbc: 'fb.1.1717099212345.AQzXy1abc',
    ip: '181.49.1.2',
    userAgent: 'Mozilla/5.0',
    url: 'https://tienda.com/productos/serum',
  },
}

describe('el evento de compra', () => {
  const e = armarEvento(VENTA, 1787700000000).data[0]

  it('usa el id del pedido para que la venta no se cuente dos veces', () => {
    // Es lo único compartido con el píxel del checkout: si además hubo
    // checkout, Meta descarta el duplicado y cuenta una.
    expect(e.event_id).toBe('6722673148043')
    expect(e.event_name).toBe('Purchase')
  })

  it('manda fbp y fbc SIN hashear', () => {
    // Hashearlos rompe el matcheo por completo, y es un error que no avisa.
    const u = e.user_data as Record<string, unknown>
    expect(u.fbp).toBe(VENTA.senales.fbp)
    expect(u.fbc).toBe(VENTA.senales.fbc)
  })

  it('hashea lo que identifica a la persona', () => {
    const u = e.user_data as Record<string, string[]>
    expect(u.em[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(u.ph[0]).toMatch(/^[a-f0-9]{64}$/)
    // Y no deja pasar el original ni por asomo.
    expect(JSON.stringify(u)).not.toContain('ana.ruiz')
    expect(JSON.stringify(u)).not.toContain('3105554433')
  })

  it('el correo se normaliza antes de hashear', () => {
    // "  Ana.Ruiz@Example.com " y "ana.ruiz@example.com" son la misma persona;
    // sin normalizar dan dos hashes y no matchea ninguno.
    expect(correoNormalizado('  Ana.Ruiz@Example.com ')).toBe(
      correoNormalizado('ana.ruiz@example.com'),
    )
    expect(correoNormalizado('no-es-correo')).toBeNull()
  })

  it('el teléfono va con país y sin símbolos', () => {
    expect(telefonoNormalizado('+57 310 555 4433')).toBe(telefonoNormalizado('573105554433'))
    // Sin código de país no se manda: un 3105554433 colombiano y uno argentino
    // son el mismo número para Meta, así que descarta los dos.
    expect(telefonoNormalizado('4433')).toBeNull()
  })

  it('la moneda va en mayúsculas y el valor como número', () => {
    const c = e.custom_data as Record<string, unknown>
    expect(c.currency).toBe('COP')
    expect(c.value).toBe(69000)
    expect(c.order_id).toBe('6722673148043')
  })

  it('dice que la venta se cerró conversando', () => {
    // No es cosmético: Meta trata distinto una conversión de mensajería que
    // una de sitio web, y contra-entrega SIEMPRE es la primera.
    expect(e.action_source).toBe('business_messaging')
  })

  it('sin señales del navegador manda igual lo que tiene', () => {
    const sin = armarEvento({ ...VENTA, senales: null }).data[0]
    const u = sin.user_data as Record<string, unknown>
    expect(u.fbp).toBeUndefined()
    expect(u.em).toBeDefined()
  })

  it('sin datos del cliente no inventa campos vacíos', () => {
    const pelado = armarEvento({
      ...VENTA,
      cliente: {},
      senales: null,
    }).data[0]
    expect(Object.keys(pelado.user_data as object)).toHaveLength(0)
  })

  it('el tiempo va en segundos, no en milisegundos', () => {
    // En milisegundos Meta lo lee como un evento del año 58.000 y lo rechaza.
    expect(e.event_time).toBe(Math.floor(1787700000000 / 1000))
  })
})
