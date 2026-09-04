import { describe, expect, it } from 'vitest'
import { matchProductsInPublication } from './publicacion-media'

const products = [
  { id: 'ref-3', title: 'Rasmiaw Referencia 3', handle: 'rasmiaw-referencia-3' },
  { id: 'tower', title: 'RasmiTower', handle: 'rasmitower' },
]

describe('producto de una publicación', () => {
  it('enlaza el producto cuando el análisis nombra la referencia', () => {
    expect(matchProductsInPublication(products, 'Se ve el rascador Rasmiaw Referencia 3 en color negro.'))
      .toEqual({ ids: ['ref-3'], status: 'identified' })
  })

  it('no inventa un producto cuando la publicación no lo identifica', () => {
    expect(matchProductsInPublication(products, 'Un gatito jugando en casa.'))
      .toEqual({ ids: [], status: 'unidentified' })
  })
})
