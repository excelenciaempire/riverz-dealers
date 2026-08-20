/**
 * En qué orden corre el plan.
 *
 * Un plan no es una lista: es un orden parcial. "Armá recuperación de carritos"
 * son dos pasos y el segundo no puede empezar antes de que termine el primero,
 * porque la automatización necesita el nombre de la plantilla que el otro
 * todavía no creó. Pero "revisá plantillas y contá el público" son dos pasos
 * que no se deben nada y esperar a uno para empezar el otro es tiempo tirado
 * delante de alguien que está mirando.
 *
 * Una ola es el conjunto de pasos que pueden correr juntos. Se resuelve acá,
 * como función pura sobre índices, para que se pueda probar sin base, sin
 * modelo y sin reloj.
 */

export interface PasoPlan {
  i: number
  dependeDe: number[]
}

export type Olas =
  | { ok: true; olas: number[][] }
  /** Los pasos que forman el ciclo, para poder decirlo en castellano. */
  | { ok: false; ciclo: number[] }

/**
 * Agrupa los pasos en olas.
 *
 * Kahn de toda la vida, con dos detalles que importan:
 *
 *  - Devuelve OLAS y no una lista ordenada. Una lista ordenada obliga a correr
 *    de a uno; las olas dicen explícitamente qué puede ir junto.
 *  - Un ciclo no lanza: devuelve quiénes lo forman. El orquestador puede
 *    equivocarse escribiendo las dependencias, y "los pasos 2 y 3 se esperan
 *    entre sí" es un mensaje que se entiende; una excepción, no.
 */
export function olas(pasos: PasoPlan[]): Olas {
  const validos = new Set(pasos.map((p) => p.i))
  const pendientes = new Map<number, Set<number>>()
  for (const p of pasos) {
    // Una dependencia a un paso que no existe se ignora en vez de trabar el
    // plan entero: es un error de escritura del modelo, no una razón para no
    // hacer nada.
    pendientes.set(p.i, new Set(p.dependeDe.filter((d) => validos.has(d) && d !== p.i)))
  }

  const resultado: number[][] = []
  const listos = new Set<number>()

  while (listos.size < pasos.length) {
    const ola = pasos
      .filter((p) => !listos.has(p.i))
      .filter((p) => [...pendientes.get(p.i)!].every((d) => listos.has(d)))
      .map((p) => p.i)

    if (ola.length === 0) {
      // Nadie puede avanzar: lo que queda se espera a sí mismo.
      return { ok: false, ciclo: pasos.filter((p) => !listos.has(p.i)).map((p) => p.i) }
    }

    ola.forEach((i) => listos.add(i))
    resultado.push(ola)
  }

  return { ok: true, olas: resultado }
}

/**
 * Todo lo que depende de estos pasos, directa o indirectamente.
 *
 * Cuando un paso falla, lo que venía atrás no se intenta. Y hay que distinguir
 * "no se pudo" de "ni se intentó": en pantalla son dos cosas distintas y
 * mezclarlas hace que el comercio crea que se rompieron cinco cosas cuando se
 * rompió una.
 */
export function alcanzadosPor(pasos: PasoPlan[], caidos: number[]): Set<number> {
  const muertos = new Set(caidos)
  let cambio = true
  while (cambio) {
    cambio = false
    for (const p of pasos) {
      if (muertos.has(p.i)) continue
      if (p.dependeDe.some((d) => muertos.has(d))) {
        muertos.add(p.i)
        cambio = true
      }
    }
  }
  caidos.forEach((i) => muertos.delete(i))
  return muertos
}
