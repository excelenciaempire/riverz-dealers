import { describe, it, expect } from 'vitest'

/**
 * El camino de un paso dentro del árbol, y qué le pasa cuando hay
 * condiciones anidadas.
 *
 * El bug: cada carril agregaba un tramo al camino en vez de reemplazar el que
 * lo describía, así que con dos condiciones encadenadas el camino tenía dos
 * tramos de más. Todas las operaciones —editar, borrar, mover, insertar—
 * caían un escalón más abajo del que tocaba. Borrar la tarjeta más profunda
 * (la que ya no tiene nada debajo) no hacía nada, en silencio.
 *
 * Se replica acá la construcción del camino porque el componente es cliente y
 * arrastra medio React; lo que importa es la forma, y es exactamente la del
 * builder.
 */

type Tramo =
  | { kind: 'root'; index: number }
  | { kind: 'branch'; parentCid: string; branch: 'yes' | 'no'; index: number }

/** Lo que hace ConditionBranches: describe el carril con índice 0. */
function carril(parentPath: Tramo[], cid: string, branch: 'yes' | 'no'): Tramo[] {
  return [...parentPath, { kind: 'branch', parentCid: cid, branch, index: 0 }]
}

/** Lo que hace StepRenderer: el índice real del paso dentro de ese carril. */
function pasoEn(parentPath: Tramo[], index: number): Tramo[] {
  const last = parentPath[parentPath.length - 1]
  if (!last || last.kind !== 'branch') {
    return [...parentPath, { kind: 'root', index }]
  }
  return [
    ...parentPath.slice(0, -1),
    { kind: 'branch', parentCid: last.parentCid, branch: last.branch, index },
  ]
}

describe('camino de un paso', () => {
  it('en el tronco es un solo tramo', () => {
    expect(pasoEn([], 2)).toEqual([{ kind: 'root', index: 2 }])
  })

  it('dentro de una condición, un tramo por nivel y no dos', () => {
    const condA = pasoEn([], 1)
    const dentroDeA = carril(condA, 'A', 'yes')
    const primerPaso = pasoEn(dentroDeA, 0)
    expect(primerPaso).toEqual([
      { kind: 'root', index: 1 },
      { kind: 'branch', parentCid: 'A', branch: 'yes', index: 0 },
    ])
  })

  it('con condiciones anidadas el largo crece de a uno', () => {
    const condA = pasoEn([], 1)
    const condB = pasoEn(carril(condA, 'A', 'yes'), 0)
    const condC = pasoEn(carril(condB, 'B', 'yes'), 0)
    const etiqueta = pasoEn(carril(condC, 'C', 'yes'), 1)

    // Tronco + tres ramas. Con el bug eran siete tramos.
    expect(etiqueta).toHaveLength(4)
    expect(etiqueta).toEqual([
      { kind: 'root', index: 1 },
      { kind: 'branch', parentCid: 'A', branch: 'yes', index: 0 },
      { kind: 'branch', parentCid: 'B', branch: 'yes', index: 0 },
      { kind: 'branch', parentCid: 'C', branch: 'yes', index: 1 },
    ])
  })

  it('el índice del último tramo es el del paso, no cero', () => {
    // Es lo que distingue "la etiqueta" de "el envío" en el mismo carril.
    const cond = pasoEn([], 0)
    const envio = pasoEn(carril(cond, 'X', 'yes'), 0)
    const etiqueta = pasoEn(carril(cond, 'X', 'yes'), 1)
    expect(envio[envio.length - 1]).toMatchObject({ index: 0 })
    expect(etiqueta[etiqueta.length - 1]).toMatchObject({ index: 1 })
  })
})
