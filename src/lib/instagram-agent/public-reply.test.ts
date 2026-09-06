import { describe, expect, it } from 'vitest'

import { publicReplyFrom } from './realtime'

describe('publicReplyFrom — la respuesta pública del comentario', () => {
  it('no corta a mitad de palabra: prefiere la oración entera', () => {
    // Instagram, 2026-08-29 18:06 UTC. Salía así, en público:
    //   "…la zona de la papada, de abajo hacia… 💬 Te escribí por privado."
    const dm =
      'El serum va primero, sobre la piel limpia y seca. Lo aplicas en el cuello y la zona de la papada, de abajo hacia arriba, y esperas a que se absorba.'
    const out = publicReplyFrom(dm)
    expect(out).toBe(
      'El serum va primero, sobre la piel limpia y seca. 💬 Te escribí por privado.',
    )
    expect(out).not.toContain('…')
  })

  it('junta las oraciones que entren en el tope', () => {
    const out = publicReplyFrom('Sí, se puede. Va en el cuello. Mañana y noche.')
    expect(out).toBe('Sí, se puede. Va en el cuello. Mañana y noche. 💬 Te escribí por privado.')
  })

  it('si no entra ni la primera oración, sólo avisa del privado', () => {
    const out = publicReplyFrom('a'.repeat(200) + '.')
    expect(out).toBe('Te escribí por privado 💬')
  })

  it('sin DM enviado, la respuesta va entera', () => {
    const out = publicReplyFrom('El serum sale $39.990.', false)
    expect(out).toBe('El serum sale $39.990.')
    expect(out).not.toContain('privado')
  })

  it('sin DM y sin texto, no publica nada', () => {
    expect(publicReplyFrom('   ', false)).toBe('')
  })

  it('nunca publica la URL que ya se envió por privado', () => {
    const out = publicReplyFrom(
      'Jaja, filtro no vendemos, pero el frasco sí 😄 Uno sale $39.990 y te dura como un mes: https://pilarargentina.store/products/serum-pilar',
    )
    expect(out).toBe(
      'Jaja, filtro no vendemos, pero el frasco sí 😄 Uno sale $39.990 y te dura como un mes 💬 Te escribí por privado.',
    )
    expect(out).not.toContain('store/products')
    expect(out).not.toContain('http')
  })

  it('tampoco publica enlaces cuando la respuesta queda sólo en el comentario', () => {
    expect(
      publicReplyFrom(
        'Puedes verlo en https://pilarargentina.store/products/serum-pilar',
        false,
      ),
    ).toBe('Puedes verlo en')
  })
})
