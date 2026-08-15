import type { BuilderStep } from "./automation-builder"

/**
 * El árbol de pasos: dónde vive cada uno y cómo se lo mueve.
 *
 * Vive fuera del componente para poder probarlo. El lienzo es visual y se
 * revisa mirándolo, pero esto no: acá un error no se ve, se nota semanas
 * después con un flujo que quedó en otro orden del que alguien armó. Ya pasó
 * una vez —el camino de cada tarjeta ganaba un tramo por cada condición
 * anidada y todas las operaciones caían un escalón más abajo— y no se detectó
 * hasta que alguien intentó borrar algo y no pasó nada.
 */

export type ParentScope =
  | { kind: "root" }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no" }

export type StepPath = (
  | { kind: "root"; index: number }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no"; index: number }
)[]

export function insertAt(
  steps: BuilderStep[],
  parent: ParentScope,
  index: number,
  node: BuilderStep,
): BuilderStep[] {
  if (parent.kind === "root") {
    const copy = [...steps]
    copy.splice(index, 0, node)
    return copy
  }
  // Busca la condición a cualquier profundidad. Antes sólo miraba el primer
  // nivel, así que el "+ Añadir" de un camino que colgaba de otra condición
  // no encontraba a su padre y no agregaba nada — el botón respondía, se
  // cerraba el menú, y no pasaba nada.
  const buscar = (lista: BuilderStep[]): BuilderStep[] =>
    lista.map((s) => {
      if (!s.branches) return s
      if (s.cid === parent.parentCid) {
        const bucket = [...s.branches[parent.branch]]
        bucket.splice(index, 0, node)
        return { ...s, branches: { ...s.branches, [parent.branch]: bucket } }
      }
      return {
        ...s,
        branches: { yes: buscar(s.branches.yes), no: buscar(s.branches.no) },
      }
    })
  return buscar(steps)
}

/** El paso que vive en `path`, o null si el camino no lleva a ninguno. */
export function getAt(steps: BuilderStep[], path: StepPath): BuilderStep | null {
  let lista = steps
  let encontrado: BuilderStep | null = null
  for (const tramo of path) {
    if (tramo.kind === "root") {
      encontrado = lista[tramo.index] ?? null
    } else {
      const padre = buscarPorCid(lista, tramo.parentCid)
      if (!padre?.branches) return null
      encontrado = padre.branches[tramo.branch][tramo.index] ?? null
    }
    if (!encontrado) return null
    lista = encontrado.branches ? [encontrado] : [encontrado]
  }
  return encontrado
}

export function buscarPorCid(steps: BuilderStep[], cid: string): BuilderStep | null {
  for (const s of steps) {
    if (s.cid === cid) return s
    if (s.branches) {
      const dentro =
        buscarPorCid(s.branches.yes, cid) ?? buscarPorCid(s.branches.no, cid)
      if (dentro) return dentro
    }
  }
  return null
}

/** ¿`cid` está dentro del subárbol de `nodo`? Un paso no puede caer adentro
 *  de sí mismo: se llevaría su propio destino y el árbol quedaría partido. */
export function contieneCid(nodo: BuilderStep, cid: string): boolean {
  if (nodo.cid === cid) return true
  if (!nodo.branches) return false
  return (
    nodo.branches.yes.some((s) => contieneCid(s, cid)) ||
    nodo.branches.no.some((s) => contieneCid(s, cid))
  )
}

export function mapAtPath(
  steps: BuilderStep[],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)

  if (head.kind === "root") {
    return steps.map((s, i) => {
      if (i !== head.index) return s
      return rest.length === 0
        ? updater(s)
        : { ...s, branches: walkBranches(s.branches, rest, updater) }
    })
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const updated = bucket.map((child, i) => {
      if (i !== head.index) return child
      return rest.length === 0
        ? updater(child)
        : { ...child, branches: walkBranches(child.branches, rest, updater) }
    })
    return { ...s, branches: { ...s.branches, [head.branch]: updated } }
  })
}

export function walkBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  updater: (s: BuilderStep) => BuilderStep,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const bucket = branches[head.branch]
  const rest = path.slice(1)
  const updated = bucket.map((child, i) => {
    if (i !== head.index) return child
    return rest.length === 0
      ? updater(child)
      : { ...child, branches: walkBranches(child.branches, rest, updater) }
  })
  return { ...branches, [head.branch]: updated }
}

export function removeAt(steps: BuilderStep[], path: StepPath): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  if (head.kind === "root") {
    if (rest.length === 0) return steps.filter((_, i) => i !== head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: removeFromBranches(s.branches, rest) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next =
      rest.length === 0
        ? bucket.filter((_, i) => i !== head.index)
        : bucket.map((child, i) =>
            i !== head.index
              ? child
              : { ...child, branches: removeFromBranches(child.branches, rest) },
          )
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

export function removeFromBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const next =
    rest.length === 0
      ? bucket.filter((_, i) => i !== head.index)
      : bucket.map((child, i) =>
          i !== head.index
            ? child
            : { ...child, branches: removeFromBranches(child.branches, rest) },
        )
  return { ...branches, [head.branch]: next }
}

export function moveAt(
  steps: BuilderStep[],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep[] {
  if (path.length === 0) return steps
  const head = path[0]
  const rest = path.slice(1)
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  if (head.kind === "root") {
    if (rest.length === 0) return swap(steps, head.index)
    return steps.map((s, i) =>
      i !== head.index ? s : { ...s, branches: moveInBranches(s.branches, rest, direction) },
    )
  }
  return steps.map((s) => {
    if (s.cid !== head.parentCid || !s.branches) return s
    const bucket = s.branches[head.branch]
    const next =
      rest.length === 0
        ? swap(bucket, head.index)
        : bucket.map((h, i) =>
            i !== head.index ? h : { ...h, branches: moveInBranches(h.branches, rest, direction) },
          )
    return { ...s, branches: { ...s.branches, [head.branch]: next } }
  })
}

export function moveInBranches(
  branches: BuilderStep["branches"],
  path: StepPath,
  direction: -1 | 1,
): BuilderStep["branches"] {
  if (!branches) return branches
  const head = path[0]
  if (head.kind !== "branch") return branches
  const rest = path.slice(1)
  const bucket = branches[head.branch]
  const swap = <T,>(arr: T[], i: number) => {
    const j = i + direction
    if (j < 0 || j >= arr.length) return arr
    const copy = [...arr]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    return copy
  }
  // Recursivo, como `removeFromBranches`. Sin bajar al hijo, un camino a más
  // de un nivel devolvía el mismo carril intacto: las flechas de mover se
  // veían habilitadas y no hacían absolutamente nada. Se nota recién a
  // profundidad tres, que es donde vive el rescate de carrito.
  const next =
    rest.length === 0
      ? swap(bucket, head.index)
      : bucket.map((h, i) =>
          i !== head.index ? h : { ...h, branches: moveInBranches(h.branches, rest, direction) },
        )
  return { ...branches, [head.branch]: next }
}

// ------------------------------------------------------------
