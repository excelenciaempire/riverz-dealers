import { describe, expect, it } from 'vitest'

import { RIOPLATENSE_TEXTO, resolverRegistro } from './registro-rioplatense'
import type { Contact } from '@/types'

/** Contacto mínimo; sólo importan canal, teléfono y external_id. */
function contacto(over: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    workspace_id: 'w1',
    channel: 'whatsapp',
    external_id: null,
    phone: null,
    name: null,
    ...over,
  } as unknown as Contact
}

/**
 * Doble de Supabase para la última escala del resolutor: el número de WhatsApp
 * del comercio. `display` null = el comercio no tiene WhatsApp conectado.
 */
function db(display: string | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({
      data: display ? { config: { display_phone_number: display } } : null,
    }),
  }
  return { from: () => chain } as never
}

const ARG = '+54 9 11 7678-3848'
const COL = '+57 300 1234567'

describe('resolverRegistro — de dónde es el CLIENTE', () => {
  it('cliente argentino por teléfono: de vos', async () => {
    const r = await resolverRegistro({
      db: db(null),
      workspaceId: 'w1',
      idioma: 'es',
      contact: contacto({ external_id: '5491176783848' }),
    })
    expect(r).toBe('rioplatense')
  })

  it('cliente colombiano: neutro, aunque el comercio sea argentino', async () => {
    const r = await resolverRegistro({
      db: db(ARG),
      workspaceId: 'w1',
      idioma: 'es',
      contact: contacto({ phone: COL }),
    })
    expect(r).toBe('neutro')
  })

  it('la dirección en la tienda gana sobre el teléfono', async () => {
    // Un número argentino que compra con dirección en Colombia: manda lo que
    // la persona escribió, no el prefijo de su línea.
    const r = await resolverRegistro({
      db: db(ARG),
      workspaceId: 'w1',
      idioma: 'es',
      contact: contacto({ phone: ARG }),
      paisEnLaTienda: 'Colombia',
    })
    expect(r).toBe('neutro')
  })

  it('acepta el país como código y como nombre', async () => {
    for (const pais of ['AR', 'Argentina', 'ARGENTINA']) {
      const r = await resolverRegistro({
        db: db(null),
        workspaceId: 'w1',
        idioma: 'es',
        contact: contacto(),
        paisEnLaTienda: pais,
      })
      expect(r, pais).toBe('rioplatense')
    }
  })

  it('sin teléfono ni pedido (Instagram, chat web), cae al país del comercio', async () => {
    const arg = await resolverRegistro({
      db: db(ARG),
      workspaceId: 'w1',
      idioma: 'es',
      contact: contacto({ channel: 'instagram', external_id: '17841400000000000' }),
    })
    expect(arg).toBe('rioplatense')

    const col = await resolverRegistro({
      db: db(COL),
      workspaceId: 'w1',
      idioma: 'es',
      contact: contacto({ channel: 'instagram', external_id: '17841400000000000' }),
    })
    expect(col).toBe('neutro')
  })

  it('Uruguay también es rioplatense', async () => {
    const r = await resolverRegistro({
      db: db(null),
      workspaceId: 'w1',
      idioma: 'es',
      contact: contacto({ phone: '+598 99 123 456' }),
    })
    expect(r).toBe('rioplatense')
  })

  it('un agente en inglés no tiene voseo que elegir', async () => {
    const r = await resolverRegistro({
      db: db(ARG),
      workspaceId: 'w1',
      idioma: 'en',
      contact: contacto({ phone: ARG }),
    })
    expect(r).toBe('neutro')
  })

  it('si la base falla, neutro', async () => {
    const roto = {
      from: () => {
        throw new Error('sin base')
      },
    } as never
    const r = await resolverRegistro({
      db: roto,
      workspaceId: 'w1',
      idioma: 'es',
      contact: contacto(),
    })
    expect(r).toBe('neutro')
  })
})

describe('RIOPLATENSE_TEXTO — normal, no exagerado', () => {
  it('pide voseo', () => {
    expect(RIOPLATENSE_TEXTO).toContain('tenés')
    expect(RIOPLATENSE_TEXTO).toContain('querés')
  })

  it('no mete jerga fuerte como ejemplo a copiar', () => {
    // El de VOZ sí las usa; escritas se leen como una imitación.
    for (const jerga of ['bárbaro', 'quilombo', 'un toque']) {
      expect(RIOPLATENSE_TEXTO.toLowerCase()).not.toContain(jerga)
    }
  })

  it('dice explícitamente que no se exagere', () => {
    expect(RIOPLATENSE_TEXTO.toLowerCase()).toContain('sin exagerar')
  })
})
