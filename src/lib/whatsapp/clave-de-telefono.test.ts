import { describe, expect, it } from 'vitest'
import { claveDeTelefono, phonesMatch } from './phone-utils'
import { formasDelTelefono } from '@/lib/shopify/order-lookup'

describe('claveDeTelefono', () => {
  it('el mismo celular argentino da la misma clave en cualquier formato', () => {
    const whatsapp = claveDeTelefono('5492954543767')
    expect(whatsapp).toBe('54543767')
    for (const tienda of ['2954543767', '+542954543767', '+54 9 2954 54-3767', '02954543767']) {
      expect(claveDeTelefono(tienda)).toBe(whatsapp)
    }
  })

  it('saca el 15 del celular escrito a la antigua', () => {
    // Antes: "51234567" contra "11234567", nunca coincidían.
    expect(claveDeTelefono('0351 15 123-4567')).toBe(claveDeTelefono('5493511234567'))
    expect(claveDeTelefono('011 15 5517-7177')).toBe(claveDeTelefono('5491155177177'))
    expect(phonesMatch('0351 15 123-4567', '5493511234567')).toBe(true)
  })

  it('no toca números de otros países', () => {
    expect(claveDeTelefono('573108878761')).toBe('08878761')
    expect(claveDeTelefono('3108878761')).toBe('08878761')
    expect(claveDeTelefono('1234')).toBeNull()
  })
})

describe('formasDelTelefono', () => {
  it('prueba el número nacional y sin el 9, como lo guarda la tienda', () => {
    const formas = formasDelTelefono('5492954543767')
    expect(formas[0]).toBe('5492954543767')
    expect(formas).toContain('+5492954543767')
    expect(formas).toContain('+542954543767')
    expect(formas).toContain('2954543767')
  })
})
