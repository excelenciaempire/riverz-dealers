import { describe, it, expect } from 'vitest'
import { samePerson, nameTokens, payerName, payerPhone } from './client'

describe('samePerson', () => {
  it('une las variantes del mismo nombre', () => {
    // Casos reales del panel de rechazados: el mismo cliente escrito al
    // revés, con y sin segundo nombre, con y sin tilde.
    expect(samePerson('Lila Noemi Toledo', 'Toledo Lila Noemí')).toBe(true)
    expect(samePerson('Lila Toledo', 'Lila Noemi Toledo')).toBe(true)
    expect(samePerson('MARIA CECILIA LARREA RATTI', 'maria cecilia larrea ratti')).toBe(true)
  })

  it('NO une a dos personas que sólo comparten nombres de pila', () => {
    // Ésta es la que importa: un falso positivo acá no ensucia una fila,
    // le manda un WhatsApp sobre un pago rechazado a alguien que nunca
    // intentó comprar.
    expect(samePerson('Maria Cecilia Lopez', 'Maria Cecilia Fernandez')).toBe(false)
    expect(samePerson('Juan Perez', 'Juan Gomez')).toBe(false)
    expect(samePerson('Ana Martinez', 'Ana Rodriguez')).toBe(false)
  })

  it('un nombre vacío no matchea con nada', () => {
    expect(samePerson('', 'Juan Perez')).toBe(false)
    expect(samePerson(null, null)).toBe(false)
    expect(samePerson('Juan Perez', undefined)).toBe(false)
  })

  it('tres tokens en común alcanzan aunque el resto difiera', () => {
    expect(samePerson('Ana Maria Sofia Lopez', 'Ana Maria Sofia Perez')).toBe(true)
  })
})

describe('nameTokens', () => {
  it('saca tildes, mayúsculas y puntuación', () => {
    expect([...nameTokens('  José-María  Núñez ')].sort()).toEqual(['jose', 'maria', 'nunez'])
  })
})

describe('payerName', () => {
  it('prefiere additional_info, que es el nombre sin enmascarar', () => {
    // En los rechazados MP enmascara `payer` pero deja el nombre real en
    // additional_info: sin esa preferencia no se puede cruzar el contacto.
    const p = {
      id: 1,
      status: 'rejected',
      payer: { first_name: 'L***', last_name: 'T***' },
      additional_info: { payer: { first_name: 'Lila', last_name: 'Toledo' } },
    }
    expect(payerName(p)).toBe('Lila Toledo')
  })

  it('cae a payer cuando no hay additional_info', () => {
    expect(payerName({ id: 1, status: 'rejected', payer: { first_name: 'Ana', last_name: 'Mensi' } }))
      .toBe('Ana Mensi')
  })

  it('devuelve cadena vacía si no hay nada', () => {
    expect(payerName({ id: 1, status: 'rejected' })).toBe('')
  })
})

describe('payerPhone', () => {
  it('lee el teléfono de additional_info', () => {
    expect(
      payerPhone({
        id: 1,
        status: 'rejected',
        additional_info: { payer: { phone: { number: '1144960458' } } },
      }),
    ).toBe('1144960458')
  })

  it('null cuando MP no lo manda, que es lo habitual en un rechazo', () => {
    expect(payerPhone({ id: 1, status: 'rejected' })).toBeNull()
  })
})
