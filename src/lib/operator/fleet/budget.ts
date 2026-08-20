/**
 * Cuánto gastó el turno, y quién.
 *
 * Antes esto no hacía falta: un turno era una secuencia de llamadas del mismo
 * agente y el total salía de sumar lo que devolvía cada una. Con equipo se
 * rompe de una forma silenciosa y cara: el techo diario se calcula sumando los
 * `prompt_tokens` de las filas de `operator_messages`, y se escribe UNA fila
 * por turno. Si el gasto de los subagentes no llega hasta esa fila, la cuenta
 * del día siguiente arranca creyendo que no se gastó nada.
 *
 * O sea que el arreglo no es rediseñar el tope. Es hacer que el número que el
 * tope ya lee sea el correcto.
 */
import type { Quien } from './types'

/** Cuántas llamadas al modelo puede hacer un turno, pase lo que pase. */
export const MAX_LLAMADAS_TURNO = 80

export interface GastoAgente {
  prompt: number
  completion: number
  /** Tokens leídos del caché: sirve para ver si el prefijo estable acierta. */
  cache: number
  llamadas: number
}

export interface Presupuesto {
  sumar(
    quien: Quien,
    u: { input?: number; output?: number; cacheRead?: number } | null | undefined,
  ): void
  total(): { promptTokens: number; completionTokens: number }
  porAgente(): Record<string, GastoAgente>
  /** Cuántas llamadas van. */
  llamadas(): number
  /**
   * ¿Se puede hacer otra llamada?
   *
   * `false` significa plantarse y contestar con lo que haya, no lanzar. Un
   * turno que se corta con una respuesta parcial es molesto; uno que explota
   * pierde todo lo que el equipo ya construyó.
   */
  puedeLlamar(): boolean
}

export function crearPresupuesto(
  maxLlamadas: number = MAX_LLAMADAS_TURNO,
): Presupuesto {
  const por = new Map<string, GastoAgente>()
  let n = 0

  return {
    sumar(quien, u) {
      n++
      const g = por.get(quien) ?? { prompt: 0, completion: 0, cache: 0, llamadas: 0 }
      g.prompt += u?.input ?? 0
      g.completion += u?.output ?? 0
      g.cache += u?.cacheRead ?? 0
      g.llamadas += 1
      por.set(quien, g)
    },
    total() {
      let promptTokens = 0
      let completionTokens = 0
      for (const g of por.values()) {
        promptTokens += g.prompt
        completionTokens += g.completion
      }
      return { promptTokens, completionTokens }
    },
    porAgente() {
      return Object.fromEntries(por)
    },
    llamadas() {
      return n
    },
    puedeLlamar() {
      return n < maxLlamadas
    },
  }
}

/**
 * Un semáforo, para no soltar N llamadas al modelo a la vez.
 *
 * El único reparto en paralelo que ya existe en el repo
 * (`src/lib/instagram-agent/send.ts`) usa `Promise.all` crudo sobre una llamada
 * por destinatario, sin límite. Funciona porque el lote es de veinticinco y
 * nadie mira. Acá hay alguien mirando, la clave es la de la plataforma y un 429
 * con `maxRetries: 0` se pierde entero.
 *
 * Seis a la vez. Arrancó en tres pensando en cuántos caben en el panel, que era
 * mirar el problema equivocado: el panel se scrollea y el comercio no está
 * leyendo cada línea, está esperando el resultado. Seis es lo que un equipo de
 * verdad hace en paralelo antes de empezar a pisarse.
 */
export const MAX_EN_PARALELO = 6

export function crearSemaforo(max: number = MAX_EN_PARALELO) {
  let libres = max
  const cola: Array<() => void> = []

  async function tomar(): Promise<void> {
    if (libres > 0) {
      libres--
      return
    }
    await new Promise<void>((res) => cola.push(res))
  }

  function soltar(): void {
    const siguiente = cola.shift()
    if (siguiente) siguiente()
    else libres++
  }

  return async function conCupo<T>(fn: () => Promise<T>): Promise<T> {
    await tomar()
    try {
      return await fn()
    } finally {
      soltar()
    }
  }
}
