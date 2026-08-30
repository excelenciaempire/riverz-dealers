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
function resolverNumero(
  iso: CountryCode,
  texto: string,
): { e164: string; pais: CountryCode } {
  const digitos = texto.replace(/\D/g, '')
  if (!digitos) return { e164: '', pais: iso }
  const explicito = texto.trim().startsWith('+')

  if (explicito) {
    const p = parsePhoneNumberFromString(`+${digitos}`)
    if (p?.isValid()) return { e164: p.number, pais: p.country ?? iso }
  }
  const nacional = parsePhoneNumberFromString(texto, iso)
  if (nacional?.isValid()) return { e164: nacional.number, pais: nacional.country ?? iso }
  if (digitos.startsWith(getCountryCallingCode(iso))) {
    const internacional = parsePhoneNumberFromString(`+${digitos}`)
    if (internacional?.isValid()) {
      return { e164: internacional.number, pais: internacional.country ?? iso }
    }
  }
  return {
    e164: explicito ? `+${digitos}` : `+${getCountryCallingCode(iso)}${digitos}`,
    pais: iso,
  }
}

const emitir = (iso: CountryCode, texto: string) => resolverNumero(iso, texto).e164

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

describe('se escriba como se escriba, sale el mismo número', () => {
  // Nadie lee "escribe sólo el número local": se pega lo que se tenga a mano.
  const mismasFormas: Array<[CountryCode, string[], string]> = [
    ['AR', ['91161047646', '5491161047646', '+5491161047646', '+54 9 11 6104 7646', '011 15-6104-7646'], '+5491161047646'],
    ['CO', ['3001234567', '573001234567', '+573001234567', '+57 300 123 4567'], '+573001234567'],
    ['MX', ['5512345678', '525512345678', '+525512345678'], '+525512345678'],
    ['US', ['2125550147', '12125550147', '+1 212 555 0147', '(212) 555-0147'], '+12125550147'],
    ['ES', ['612345678', '34612345678', '+34612345678'], '+34612345678'],
  ]
  for (const [iso, formas, esperado] of mismasFormas) {
    for (const forma of formas) {
      it(`${iso}: ${JSON.stringify(forma)} → ${esperado}`, () => {
        expect(emitir(iso, forma)).toBe(esperado)
      })
    }
  }

  it('con + de otro país, el selector se corrige solo', () => {
    // Está en Colombia y pega un número argentino entero: manda lo que pegó.
    const r = resolverNumero('CO', '+5491161047646')
    expect(r.e164).toBe('+5491161047646')
    expect(r.pais).toBe('AR')
  })

  it('sin +, el país elegido sigue mandando', () => {
    // "5512345678" es nacional válido en México; no se reinterpreta como +55.
    expect(resolverNumero('MX', '5512345678').pais).toBe('MX')
  })

  it('un nacional que parece de otro país no se fuga', () => {
    // `15512345678` es el formato nacional del móvil mexicano +5215512345678,
    // y a la vez un +1 551… válido de Estados Unidos. Manda el país elegido.
    const r = resolverNumero('MX', '15512345678')
    expect(r.e164).toBe('+5215512345678')
    expect(r.pais).toBe('MX')
  })

  it('a medio escribir no revienta ni pega dos prefijos', () => {
    expect(emitir('CO', '300')).toBe('+57300')
    expect(emitir('AR', '+54')).toBe('+54')
    expect(emitir('AR', '11')).toBe('+5411')
  })
})
