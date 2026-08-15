import { describe, it, expect } from 'vitest'
import {
  insertAt,
  removeAt,
  getAt,
  moveAt,
  contieneCid,
  type ParentScope,
  type StepPath,
} from './step-tree'
import type { BuilderStep } from './automation-builder'

/**
 * Mover un paso no puede desordenar el resto.
 *
 * Un error acá no se ve: el lienzo se dibuja igual y el flujo queda en otro
 * orden del que alguien armó, cosa que se nota semanas después cuando un
 * mensaje sale antes de la espera que tenía que frenarlo. Por eso se prueba
 * la cuenta, no la pantalla.
 */

const paso = (cid: string): BuilderStep => ({
  cid,
  step_type: 'add_tag',
  step_config: { tag_id: cid },
})

const condicion = (cid: string, yes: BuilderStep[], no: BuilderStep[] = []): BuilderStep => ({
  cid,
  step_type: 'condition',
  step_config: {},
  branches: { yes, no },
})

/** Lo mismo que hace el lienzo al soltar: sacar y volver a poner. */
function mover(
  steps: BuilderStep[],
  from: StepPath,
  destino: ParentScope,
  index: number,
): BuilderStep[] {
  const nodo = getAt(steps, from)
  if (!nodo) return steps
  if (destino.kind === 'branch' && contieneCid(nodo, destino.parentCid)) return steps
  const origen = from[from.length - 1]
  const mismoCarril =
    destino.kind === 'root'
      ? origen.kind === 'root'
      : origen.kind === 'branch' &&
        origen.parentCid === destino.parentCid &&
        origen.branch === destino.branch
  const corregido = mismoCarril && origen.index < index ? index - 1 : index
  return insertAt(removeAt(steps, from), destino, corregido, nodo)
}

const cids = (steps: BuilderStep[]) => steps.map((s) => s.cid)

describe('mover dentro del tronco', () => {
  const base = () => [paso('a'), paso('b'), paso('c'), paso('d')]

  it('hacia atrás lo deja justo en el hueco elegido', () => {
    const r = mover(base(), [{ kind: 'root', index: 3 }], { kind: 'root' }, 1)
    expect(cids(r)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('hacia adelante también, descontando el lugar que dejó libre', () => {
    // Sin la corrección, sacar "a" corre todo y "a" aterriza un lugar más
    // allá del hueco que se marcó.
    const r = mover(base(), [{ kind: 'root', index: 0 }], { kind: 'root' }, 2)
    expect(cids(r)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('soltarlo donde ya estaba no cambia nada', () => {
    expect(cids(mover(base(), [{ kind: 'root', index: 1 }], { kind: 'root' }, 1))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
    expect(cids(mover(base(), [{ kind: 'root', index: 1 }], { kind: 'root' }, 2))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('al principio y al final', () => {
    expect(cids(mover(base(), [{ kind: 'root', index: 2 }], { kind: 'root' }, 0))).toEqual([
      'c',
      'a',
      'b',
      'd',
    ])
    expect(cids(mover(base(), [{ kind: 'root', index: 0 }], { kind: 'root' }, 4))).toEqual([
      'b',
      'c',
      'd',
      'a',
    ])
  })
})

describe('mover entre el tronco y un camino', () => {
  //  a → COND(x){ yes: [p, q], no: [r] } → z
  const base = () => [
    paso('a'),
    condicion('x', [paso('p'), paso('q')], [paso('r')]),
    paso('z'),
  ]

  it('del camino al tronco, sin tocar lo que queda en el camino', () => {
    const r = mover(
      base(),
      [{ kind: 'root', index: 1 }, { kind: 'branch', parentCid: 'x', branch: 'yes', index: 0 }],
      { kind: 'root' },
      0,
    )
    expect(cids(r)).toEqual(['p', 'a', 'x', 'z'])
    const cond = r.find((s) => s.cid === 'x')!
    expect(cids(cond.branches!.yes)).toEqual(['q'])
    // La otra rama ni se entera.
    expect(cids(cond.branches!.no)).toEqual(['r'])
  })

  it('del tronco a un camino', () => {
    const r = mover(base(), [{ kind: 'root', index: 2 }], {
      kind: 'branch',
      parentCid: 'x',
      branch: 'no',
    }, 0)
    expect(cids(r)).toEqual(['a', 'x'])
    const cond = r.find((s) => s.cid === 'x')!
    expect(cids(cond.branches!.no)).toEqual(['z', 'r'])
    expect(cids(cond.branches!.yes)).toEqual(['p', 'q'])
  })

  it('dentro del mismo camino, con la misma corrección que el tronco', () => {
    const r = mover(
      base(),
      [{ kind: 'root', index: 1 }, { kind: 'branch', parentCid: 'x', branch: 'yes', index: 1 }],
      { kind: 'branch', parentCid: 'x', branch: 'yes' },
      0,
    )
    const cond = r.find((s) => s.cid === 'x')!
    expect(cids(cond.branches!.yes)).toEqual(['q', 'p'])
    expect(cids(r)).toEqual(['a', 'x', 'z'])
  })
})

describe('lo que no se permite', () => {
  it('una condición no puede caer dentro de sí misma', () => {
    // Se llevaría su propio destino: el árbol quedaría partido y los pasos de
    // adentro desaparecerían del lienzo sin que nadie los haya borrado.
    const arbol = [paso('a'), condicion('x', [paso('p')])]
    const r = mover(arbol, [{ kind: 'root', index: 1 }], {
      kind: 'branch',
      parentCid: 'x',
      branch: 'yes',
    }, 0)
    expect(cids(r)).toEqual(['a', 'x'])
    expect(cids(r[1].branches!.yes)).toEqual(['p'])
  })

  it('un camino que no existe no rompe nada', () => {
    const arbol = [paso('a'), paso('b')]
    expect(cids(mover(arbol, [{ kind: 'root', index: 9 }], { kind: 'root' }, 0))).toEqual([
      'a',
      'b',
    ])
  })
})

describe('condiciones anidadas', () => {
  //  COND(x){ yes: [ COND(y){ yes: [m, n] } ] }
  const base = () => [condicion('x', [condicion('y', [paso('m'), paso('n')])])]

  it('mover el más profundo no toca a sus padres', () => {
    const r = mover(
      base(),
      [
        { kind: 'root', index: 0 },
        { kind: 'branch', parentCid: 'x', branch: 'yes', index: 0 },
        { kind: 'branch', parentCid: 'y', branch: 'yes', index: 1 },
      ],
      { kind: 'branch', parentCid: 'y', branch: 'yes' },
      0,
    )
    const x = r[0]
    const y = x.branches!.yes[0]
    expect(cids(y.branches!.yes)).toEqual(['n', 'm'])
    expect(x.cid).toBe('x')
    expect(y.cid).toBe('y')
  })

  it('las flechas de mover también llegan a lo profundo', () => {
    // moveAt no recursaba: a más de un nivel devolvía el carril intacto, así
    // que la flecha se veía habilitada y no pasaba nada. El rescate de carrito
    // vive justo a esa profundidad.
    const r = moveAt(
      base(),
      [
        { kind: 'root', index: 0 },
        { kind: 'branch', parentCid: 'x', branch: 'yes', index: 0 },
        { kind: 'branch', parentCid: 'y', branch: 'yes', index: 0 },
      ],
      1,
    )
    const y = r[0].branches!.yes[0]
    expect(cids(y.branches!.yes)).toEqual(['n', 'm'])
  })

  it('en el extremo del carril profundo no se mueve nada', () => {
    const r = moveAt(
      base(),
      [
        { kind: 'root', index: 0 },
        { kind: 'branch', parentCid: 'x', branch: 'yes', index: 0 },
        { kind: 'branch', parentCid: 'y', branch: 'yes', index: 0 },
      ],
      -1,
    )
    expect(cids(r[0].branches!.yes[0].branches!.yes)).toEqual(['m', 'n'])
  })

  it('getAt encuentra al más profundo', () => {
    const nodo = getAt(base(), [
      { kind: 'root', index: 0 },
      { kind: 'branch', parentCid: 'x', branch: 'yes', index: 0 },
      { kind: 'branch', parentCid: 'y', branch: 'yes', index: 1 },
    ])
    expect(nodo?.cid).toBe('n')
  })
})
