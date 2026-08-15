import { describe, it, expect } from 'vitest'
import { isAfter } from './purchased-since'

/**
 * El caso real: Norma abandonó el carrito, el flujo anotó el disparo a las
 * 19:10 UTC, ella compró a las 20:44 UTC — que Shopify reporta como
 * "2026-08-14T16:44:28-04:00" — y el flujo le mandó igual el mensaje de
 * carrito abandonado porque comparó las dos fechas como texto.
 */
describe('isAfter', () => {
  it('ve la compra aunque Shopify la reporte en la zona de la tienda', () => {
    expect(isAfter('2026-08-14T16:44:28-04:00', '2026-08-14T19:10:01.332Z')).toBe(true)
  })

  it('funciona con la fecha tal como la devuelve Postgres', () => {
    expect(isAfter('2026-08-14T16:44:28-04:00', '2026-08-14 19:10:01.332107+00')).toBe(true)
  })

  it('una compra anterior sigue siendo anterior', () => {
    expect(isAfter('2026-08-14T10:00:00-04:00', '2026-08-14T19:10:01.332Z')).toBe(false)
  })

  it('el mismo instante no cuenta como posterior', () => {
    expect(isAfter('2026-08-14T15:10:01.332-04:00', '2026-08-14T19:10:01.332Z')).toBe(false)
  })

  it('una fecha ilegible no inventa una compra', () => {
    expect(isAfter(null, '2026-08-14T19:10:01.332Z')).toBe(false)
    expect(isAfter('', '2026-08-14T19:10:01.332Z')).toBe(false)
    expect(isAfter('2026-08-14T16:44:28-04:00', 'cualquier cosa')).toBe(false)
  })
})
