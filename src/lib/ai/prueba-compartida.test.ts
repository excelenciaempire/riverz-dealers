import { beforeAll, describe, expect, it } from 'vitest'
import { tokenDePrueba, verificarTokenDePrueba, VIDA_DEL_LINK_MS } from './prueba-compartida'

const W = '234604a9-909b-4e50-952b-acde4a85593a'

describe('link de prueba', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
  })

  it('abre la cuenta que lo firmó mientras no venza', () => {
    const token = tokenDePrueba(W, 1_000)
    expect(verificarTokenDePrueba(token, 2_000)).toBe(W)
    expect(verificarTokenDePrueba(token, 1_000 + VIDA_DEL_LINK_MS + 1)).toBeNull()
  })

  it('no abre nada con la firma cambiada ni con otra cuenta', () => {
    const token = tokenDePrueba(W)
    const [, vence, firma] = token.split('.')
    expect(verificarTokenDePrueba(`36f81b96-41b9-4d29-b72e-11be3d3070a3.${vence}.${firma}`)).toBeNull()
    expect(verificarTokenDePrueba(`${W}.${vence}.${'x'.repeat(firma.length)}`)).toBeNull()
    expect(verificarTokenDePrueba('basura')).toBeNull()
    expect(verificarTokenDePrueba(null)).toBeNull()
  })
})
