import { describe, expect, it } from 'vitest'
import {
  AsYouType,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js'

/**
 * La lógica de `CampoTelefono`, sin React.
 *
 * Se prueba acá y no montando el componente porque lo que se rompió es
 * aritmética de prefijos, no pintura: el ida y vuelta guardado → campo →
 * guardado tiene que devolver el MISMO número, y en Argentina no lo hacía.
 */
function emitir(iso: CountryCode, texto: string): string {
  const digitos = texto.replace(/\D/g, '')
  if (!digitos) return ''
  const p = parsePhoneNumberFromString(texto, iso)
  return p && p.isValid() ? p.number : `+${getCountryCallingCode(iso)}${digitos}`
}

/** Interpreta lo que llega de afuera, con `+` o sin él (así lo guarda la base). */
function interpretar(value: string) {
  const directo = parsePhoneNumberFromString(value)
  if (directo?.country) return directo
  const solo = value.trim()
  if (!/^\d{6,15}$/.test(solo)) return undefined
  return parsePhoneNumberFromString(`+${solo}`)
}

/** Lo que el campo muestra cuando le llega un número ya guardado. */
function enElCampo(guardado: string): { pais: CountryCode; texto: string } {
  const p = interpretar(guardado)!
  const pais = p.country!
  return { pais, texto: new AsYouType(pais).input(p.formatNational().replace(/[^\d\s()-]/g, '')) }
}

describe('el número guardado se muestra, venga con + o sin él', () => {
  it('la base guarda SIN el +, y aun así se ve', () => {
    // `normalizeToWhatsApp` quita el `+` porque es lo que quiere Meta. Sin
    // esto, libphonenumber no deduce el país y el campo quedaba VACÍO con el
    // número bien guardado (verificado en producción el 2026-08-30).
    const p = interpretar('5491161047646')
    expect(p?.country).toBe('AR')
    expect(p?.number).toBe('+5491161047646')
  })

  it('con el + sigue funcionando igual', () => {
    expect(interpretar('+573001234567')?.country).toBe('CO')
  })

  it('un texto nacional suelto no se puede adivinar, y no se inventa', () => {
    expect(interpretar('11 6104-7646')).toBeUndefined()
    expect(interpretar('')).toBeUndefined()
    expect(interpretar('no es un teléfono')).toBeUndefined()
  })
})

describe('el ida y vuelta no puede cambiar el número', () => {
  const guardados = [
    '+5491161047646', // móvil argentino: el caso que se rompía
    '+541161047646', // fijo argentino
    '+573001234567',
    '+5215512345678',
    '+12125550147',
    '+34612345678',
    '+59899123456',
  ]

  for (const g of guardados) {
    it(`${g} sobrevive a abrir y guardar sin tocar nada`, () => {
      const { pais, texto } = enElCampo(g)
      expect(emitir(pais, texto)).toBe(g)
    })
  }

  it('el móvil argentino no se convierte en quince dígitos', () => {
    // El formato nacional argentino trae el 0 de tronco y el 15 del móvil.
    // Pegarlos detrás del +54 daba +540111561047646, que ni existe y que
    // `isValid()` daba por bueno — por eso no lo frenaba ninguna validación.
    const { texto } = enElCampo('+5491161047646')
    expect(texto).toContain('15')
    expect(emitir('AR', texto)).toBe('+5491161047646')
    expect(emitir('AR', texto)).not.toBe('+540111561047646')
  })
})

describe('lo que se teclea a mano', () => {
  it('un argentino escribiendo su móvil con el 9', () => {
    expect(emitir('AR', '91161047646')).toBe('+5491161047646')
  })

  it('un argentino escribiendo sin el 9 (fijo)', () => {
    expect(emitir('AR', '11 6104-7646')).toBe('+541161047646')
  })

  it('el resto de los países sigue igual que antes', () => {
    expect(emitir('CO', '300 123 4567')).toBe('+573001234567')
    expect(emitir('MX', '55 1234 5678')).toBe('+525512345678')
    expect(emitir('US', '(212) 555-0147')).toBe('+12125550147')
    expect(emitir('ES', '612 34 56 78')).toBe('+34612345678')
  })

  it('a medio escribir no revienta: cae al pegado simple', () => {
    expect(emitir('CO', '300')).toBe('+57300')
    expect(emitir('AR', '11')).toBe('+5411')
  })

  it('vacío es vacío', () => {
    expect(emitir('AR', '')).toBe('')
    expect(emitir('AR', '   ')).toBe('')
  })
})
