/**
 * Una base de mentira que anota lo que le escriben.
 *
 * `proponer` y `construir` insertan en `operator_actions`, así que sin esto no
 * se puede probar el camino de escritura sin una base de verdad. Y probarlo
 * contra la base real sería peor de lo que parece: dejaría filas de prueba en
 * la cuenta de un comercio y ataría la suite a que haya red.
 *
 * Es deliberadamente tonta. Sólo entiende la cadena que usa el código de
 * escritura —`from().insert().select().single()`— y devuelve ids fijos. Si
 * alguien agrega una consulta con otra forma, esto va a fallar en la prueba y
 * no en producción, que es exactamente donde tiene que fallar.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface InsertRegistrado {
  tabla: string
  fila: Record<string, unknown>
}

export interface FakeDb {
  db: SupabaseClient
  inserts: InsertRegistrado[]
  /** Los inserts de una tabla, para afirmar sin filtrar a mano. */
  en(tabla: string): Record<string, unknown>[]
}

/**
 * Ganchos para frenar una consulta a mitad de camino.
 *
 * Existen para una sola cosa: poder afirmar que dos lecturas de la misma
 * respuesta corren AL MISMO TIEMPO. Sin un freno, las dos terminan en la misma
 * microtarea y no hay forma de distinguir "en paralelo" de "muy rápido en
 * serie" sin medir tiempo, que es justo lo que no se puede hacer en una prueba
 * que tiene que dar igual en una máquina ocupada.
 *
 * Reciben el nombre de la tabla para que la prueba cuente sólo las suyas: el
 * orquestador lee media cuenta para armar su prompt, y esas lecturas también
 * pasarían por acá.
 */
export interface FrenosFakeDb {
  /** Se espera antes de devolver las filas de una lectura. */
  antesDeLeer?: (tabla: string) => Promise<void> | void
  /** Se espera antes de devolver el id de un insert. */
  antesDeEscribir?: (tabla: string) => Promise<void> | void
}

export function fakeDb(frenos: FrenosFakeDb = {}): FakeDb {
  const inserts: InsertRegistrado[] = []
  let n = 0

  const from = (tabla: string) => {
    const cadena = {
      insert(fila: Record<string, unknown>) {
        inserts.push({ tabla, fila })
        n++
        const id = `${tabla}-${n}`
        return {
          select() {
            return {
              async single() {
                await frenos.antesDeEscribir?.(tabla)
                return { data: { id }, error: null }
              },
            }
          },
        }
      },
      // Las lecturas devuelven vacío: un subagente que consulta en una prueba
      // recibe "no hay nada", que es un caso tan válido como cualquier otro.
      select() {
        return cadena
      },
      eq() {
        return cadena
      },
      in() {
        return cadena
      },
      order() {
        return cadena
      },
      limit() {
        return cadena
      },
      // `resolveSegment` pagina con `range`, así que sin esto el subagente de
      // contactos explota en la prueba con un "no es una función" que no dice
      // nada. Es el caso que anticipa el comentario de arriba.
      range() {
        return cadena
      },
      not() {
        return cadena
      },
      gte() {
        return cadena
      },
      lte() {
        return cadena
      },
      or() {
        return cadena
      },
      update() {
        return cadena
      },
      delete() {
        return cadena
      },
      upsert() {
        return cadena
      },
      async maybeSingle() {
        await frenos.antesDeLeer?.(tabla)
        return { data: null, error: null }
      },
      then(
        res: (v: { data: unknown[]; error: null; count: number }) => unknown,
        rej?: (e: unknown) => unknown,
      ) {
        return Promise.resolve(frenos.antesDeLeer?.(tabla))
          .then(() => ({ data: [] as unknown[], error: null as null, count: 0 }))
          .then(res, rej)
      },
    }
    return cadena
  }

  return {
    db: { from } as unknown as SupabaseClient,
    inserts,
    en: (tabla: string) =>
      inserts.filter((i) => i.tabla === tabla).map((i) => i.fila),
  }
}
