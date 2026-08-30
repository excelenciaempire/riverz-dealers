import { describe, expect, it } from 'vitest'

import {
  REGLAS_POR_DEFECTO,
  reglasDesdeFila,
  toleranciaDesdeTexto,
} from './reglas-de-cobro'

/**
 * La tolerancia se escribe a mano y decide sobre plata: 0,5% y 5% no se
 * parecen en nada cuando lo que está en juego es dar un pedido por cobrado.
 */
describe('la tolerancia que escribe el comercio', () => {
  it('acepta la coma, que es como se escribe en español', () => {
    // Sin esto el campo terminaba en 5 —el máximo— mientras la persona creía
    // haber puesto 0,5: cada tecla pasaba por `Number` y el punto recién
    // tipeado no sobrevivía.
    expect(toleranciaDesdeTexto('0,5')).toBe(0.5)
    expect(toleranciaDesdeTexto('0.5')).toBe(0.5)
  })

  it('no deja pasar más que el máximo', () => {
    expect(toleranciaDesdeTexto('90')).toBe(5)
  })

  it('vacío es exacto, no "lo de siempre"', () => {
    // Borrar el campo tiene que significar "que coincida exacto"; caer en el
    // valor por defecto sería aflojar el control sin que nadie lo pida.
    expect(toleranciaDesdeTexto('')).toBe(0)
    expect(toleranciaDesdeTexto('   ')).toBe(0)
  })

  it('lo que no es un número no cambia nada', () => {
    expect(toleranciaDesdeTexto('abc')).toBe(REGLAS_POR_DEFECTO.toleranciaPct)
  })
})

describe('las reglas que vienen de la base', () => {
  it('sin fila rigen las de siempre', () => {
    expect(reglasDesdeFila(null)).toEqual(REGLAS_POR_DEFECTO)
  })

  it('una columna que falta no afloja el control', () => {
    // Una fila vieja —o un select que no trajo la columna— no puede volverse
    // "no exijas comprobante": lo que no está dicho es lo estricto.
    expect(reglasDesdeFila({ pago_tolerancia_pct: 1 })).toEqual({
      ...REGLAS_POR_DEFECTO,
      toleranciaPct: 1,
    })
  })

  it('lee lo que el comercio eligió', () => {
    expect(
      reglasDesdeFila({
        pago_exige_comprobante: false,
        pago_un_solo_pendiente: false,
        pago_exige_referencia: false,
        pago_tolerancia_pct: '2.50',
      }),
    ).toEqual({
      exigeComprobante: false,
      unSoloPendiente: false,
      exigeReferencia: false,
      toleranciaPct: 2.5,
    })
  })
})
