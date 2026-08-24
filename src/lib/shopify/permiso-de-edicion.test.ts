import { describe, it, expect } from 'vitest'
import { faltaPermiso } from './order-edit'
import { shopifyScopes } from './oauth'

describe('editar un pedido pide su propio permiso', () => {
  it('pide write_order_edits en el OAuth', () => {
    // `write_orders` NO alcanza para orderEditBegin. Sin esta línea, update_order
    // devuelve "no pude actualizar el pedido" en TODAS las tiendas conectadas y
    // ningún reintento lo arregla. Medido el 2026-08-24 contra la tienda demo.
    const scopes = shopifyScopes().split(',')
    expect(scopes).toContain('write_order_edits')
    expect(scopes).toContain('read_order_edits')
  })

  it('reconoce el ACCESS_DENIED que Shopify contesta con 200', () => {
    // Shopify no devuelve 403: devuelve 200 con el error adentro. Descartarlo
    // era lo que hacía pasar un permiso faltante por un fallo transitorio.
    const errores = [
      {
        message: 'Access denied for orderEditBegin field.',
        extensions: { code: 'ACCESS_DENIED', requiredAccess: 'Requires `write_order_edits` access scope.' },
      },
    ]
    expect(faltaPermiso(errores)).toContain('write_order_edits')
  })

  it('no confunde un error cualquiera con un permiso faltante', () => {
    expect(faltaPermiso([{ message: 'Throttled', extensions: { code: 'THROTTLED' } }])).toBeNull()
    expect(faltaPermiso(undefined)).toBeNull()
    expect(faltaPermiso([])).toBeNull()
  })
})
