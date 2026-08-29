import { describe, it, expect } from 'vitest'
import { armarPaso, idDePaso } from './meta-conversions'

/**
 * Los dos pasos del medio.
 *
 * Meta se enteraba de los extremos —`Contact` al abrir la conversación,
 * `Purchase` al comprar— y de nada entre medio. Para el algoritmo, alguien que
 * eligió su producto y tocó "ir a pagar" era igual a quien preguntó el horario
 * y se fue. Con contra-entrega pesa doble: la venta se confirma días después,
 * así que sin señales intermedias la campaña pasa esos días a ciegas.
 *
 * Lo que se fija acá es el CUERPO, que es donde esto se rompe sin avisar: Meta
 * acepta un evento mal armado con un 200 y después no lo empareja con nadie.
 */

const base = {
  workspaceId: 'w1',
  conversationId: 'c1',
  paso: 'AddToCart' as const,
}

describe('el id del paso', () => {
  it('lo comparten el navegador y el servidor', () => {
    // Si no fuera el mismo, Meta contaría el evento dos veces: una por el
    // píxel de la tienda y otra por la API.
    expect(idDePaso({ paso: 'AddToCart', conversationId: 'c1', variantId: '42' })).toBe(
      'wc_atc_c1_42',
    )
    expect(idDePaso({ paso: 'InitiateCheckout', conversationId: 'c1' })).toBe('wc_ic_c1')
  })

  it('dos productos distintos son dos eventos, no uno repetido', () => {
    const a = idDePaso({ paso: 'AddToCart', conversationId: 'c1', variantId: '1' })
    const b = idDePaso({ paso: 'AddToCart', conversationId: 'c1', variantId: '2' })
    expect(a).not.toBe(b)
  })

  it('no deja pasar lo que no es un id', () => {
    // El valor sale de una URL que escribió un modelo y termina en la clave
    // única de la tabla.
    expect(idDePaso({ paso: 'AddToCart', conversationId: 'c1', variantId: "1'; drop--" })).toBe(
      'wc_atc_c1_1drop',
    )
  })
})

describe('el cuerpo que se le manda a Meta', () => {
  it('lleva el importe y el producto', () => {
    const cuerpo = armarPaso({
      ...base,
      variantId: '42',
      cantidad: 2,
      value: 79980,
      currency: 'ars',
    })
    const ev = cuerpo.data[0] as Record<string, unknown>
    const custom = ev.custom_data as Record<string, unknown>
    expect(ev.event_name).toBe('AddToCart')
    // Sin importe Meta cuenta el evento pero no puede optimizar por valor, que
    // es la mitad de para qué se manda.
    expect(custom.value).toBe(79980)
    expect(custom.currency).toBe('ARS')
    expect(custom.contents).toEqual([{ id: '42', quantity: 2 }])
  })

  it('la persona está en la tienda, no en otro chat', () => {
    // `action_source` mal puesto le baja a Meta la calidad del emparejamiento.
    const ev = armarPaso(base).data[0] as Record<string, unknown>
    expect(ev.action_source).toBe('website')
  })

  it('el fbp y el fbc van SIN hashear', () => {
    // Hashearlos rompe el matcheo por completo — es el error clásico de CAPI.
    const ev = armarPaso({ ...base, senales: { fbp: 'fb.1.2.3', fbc: 'fb.1.9.abc' } })
      .data[0] as Record<string, unknown>
    const user = ev.user_data as Record<string, unknown>
    expect(user.fbp).toBe('fb.1.2.3')
    expect(user.fbc).toBe('fb.1.9.abc')
  })

  it('sin datos de más: un evento sin precio no inventa un valor cero', () => {
    const ev = armarPaso(base).data[0] as Record<string, unknown>
    expect(ev.custom_data).toBeUndefined()
  })
})
