import { describe, it, expect } from 'vitest'
import { formasDelNumero, filtroDeNumero, conAlmohadilla } from './numero'

describe('el número de pedido, con o sin almohadilla', () => {
  it('busca las dos formas venga como venga', () => {
    // Shopify guarda `#1001`, Tiendanube `1001`, y el cliente escribe
    // cualquiera de las dos. Las tres entradas tienen que buscar lo mismo.
    expect(formasDelNumero('#1001')).toEqual(['1001', '#1001'])
    expect(formasDelNumero('1001')).toEqual(['1001', '#1001'])
    expect(formasDelNumero('  #1001  ')).toEqual(['1001', '#1001'])
  })

  it('encuentra el pedido que el agente acaba de crear en Shopify', () => {
    // El caso que estaba roto: create_order devolvía `#1001`, el modelo lo
    // repetía tal cual en update_order, y la búsqueda le sacaba la almohadilla
    // antes de comparar contra una fila que la tenía.
    const filtro = filtroDeNumero('#1001')
    expect(filtro).toContain('order_number.eq."#1001"')
    expect(filtro).toContain('order_number.eq."1001"')
  })

  it('sin número no hay filtro', () => {
    // Un filtro vacío en `or()` traería cualquier pedido de la persona: quien
    // llame decide si eso es "el más reciente" o un error.
    expect(filtroDeNumero('')).toBeNull()
    expect(filtroDeNumero('   ')).toBeNull()
    expect(filtroDeNumero('#')).toBeNull()
  })

  it('lo muestra con UNA almohadilla', () => {
    // El título de la aprobación salía «¿Reembolsar el pedido ##1002?» porque la
    // ponía a mano sobre un número de Shopify que ya la traía.
    expect(conAlmohadilla('#1002')).toBe('#1002')
    expect(conAlmohadilla('1002')).toBe('#1002')
    expect(conAlmohadilla('##1002')).toBe('#1002')
    expect(conAlmohadilla(null)).toBe('')
    expect(conAlmohadilla('#')).toBe('')
  })

  it('no deja escapar la comilla del valor', () => {
    // La coma separa condiciones y el punto separa columna/operador: si el
    // valor no fuera entre comillas, un número raro inventaría filtros.
    const filtro = filtroDeNumero('A,1.2')!
    expect(filtro.split(',').length).toBeGreaterThan(0)
    expect(filtro).toContain('"A,1.2"')
    expect(filtroDeNumero('1"1')).not.toContain('"1"1"')
  })
})
