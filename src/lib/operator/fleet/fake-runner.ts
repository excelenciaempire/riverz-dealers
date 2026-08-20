/**
 * Un modelo de mentira, con guion.
 *
 * No vive dentro de un `.test.ts` porque lo usan varias pruebas y porque su
 * contrato importa: es lo que permite probar el reparto, las olas, la
 * concurrencia, el presupuesto y el orden de los eventos sin llamar a la API ni
 * una vez. El saldo de Anthropic es de la casa, y una suite que lo gasta se
 * termina dejando de correr.
 *
 * Dos propiedades a propósito:
 *
 *  - **El guion se indexa por `quien`.** Cada agente tiene su libreto, así que
 *    una prueba de reparto puede afirmar exactamente quién habló y en qué orden
 *    sin depender de qué hubiera contestado un modelo real.
 *  - **La concurrencia se controla a mano, sin relojes.** Un `Deferred` por
 *    acto deja la llamada colgada hasta que la prueba la suelta. Nada de
 *    `setTimeout`: una prueba de concurrencia con esperas reales es lenta y,
 *    peor, falla sola cuando la máquina está ocupada.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { LlamadaModelo, ModelRunner } from './runner'

export interface Diferido {
  promesa: Promise<void>
  soltar: () => void
}

export function diferido(): Diferido {
  let soltar!: () => void
  const promesa = new Promise<void>((res) => {
    soltar = res
  })
  return { promesa, soltar }
}

export type ActoGuion =
  /** Contesta texto y termina el turno. */
  | { texto: string }
  /** Pide herramientas. El loop las ejecuta y vuelve a llamar. */
  | { usa: Array<{ name: string; input: Record<string, unknown> }>; texto?: string }
  /** Explota, para probar el fallo parcial. */
  | { falla: string }
  /** Espera a que la prueba lo suelte, y recién ahí contesta. */
  | { espera: Diferido; texto: string }

export interface RegistroLlamada {
  quien: string
  model: string
  system: string
  tools: string[]
  mensajes: number
}

export interface FakeRunner {
  runner: ModelRunner
  /** Todas las llamadas, en orden. */
  llamadas: RegistroLlamada[]
  /** Cuántas corrieron al mismo tiempo, como mucho. */
  simultaneas: { max: number; ahora: number }
  /** Los deltas emitidos, por quien los emitió. */
  emitido: Array<{ quien: string; texto: string }>
}

/** Uso fijo, para que el presupuesto se pueda afirmar exacto. */
export const USO_FALSO = { input_tokens: 100, output_tokens: 20 }

function textoDe(system: LlamadaModelo['system']): string {
  return typeof system === 'string' ? system : system.map((b) => b.text).join('\n')
}

/**
 * Arma un runner falso a partir de un guion por agente.
 *
 * Si un agente pide más vueltas que actos tiene su guion, el último acto se
 * repite: así una prueba que no le importa el final no tiene que escribir un
 * acto de cierre.
 */
export function fakeRunner(guiones: Record<string, ActoGuion[]>): FakeRunner {
  const llamadas: RegistroLlamada[] = []
  const simultaneas = { max: 0, ahora: 0 }
  const emitido: Array<{ quien: string; texto: string }> = []
  const cursor = new Map<string, number>()

  const runner: ModelRunner = async (llamada, emit) => {
    llamadas.push({
      quien: llamada.quien,
      model: llamada.model,
      system: textoDe(llamada.system),
      tools: llamada.tools.map((t) => t.name),
      mensajes: llamada.messages.length,
    })

    simultaneas.ahora++
    simultaneas.max = Math.max(simultaneas.max, simultaneas.ahora)
    try {
      const guion = guiones[llamada.quien] ?? [{ texto: 'listo' }]
      const i = cursor.get(llamada.quien) ?? 0
      cursor.set(llamada.quien, i + 1)
      const acto = guion[Math.min(i, guion.length - 1)]

      if ('espera' in acto) {
        await acto.espera.promesa
        emit({ tipo: 'texto', delta: acto.texto })
        emitido.push({ quien: llamada.quien, texto: acto.texto })
        return mensaje([{ type: 'text', text: acto.texto }])
      }

      if ('falla' in acto) throw new Error(acto.falla)

      if ('usa' in acto) {
        if (acto.texto) {
          emit({ tipo: 'texto', delta: acto.texto })
          emitido.push({ quien: llamada.quien, texto: acto.texto })
        }
        const bloques: Anthropic.ContentBlock[] = []
        if (acto.texto) bloques.push({ type: 'text', text: acto.texto } as Anthropic.ContentBlock)
        acto.usa.forEach((u, n) => {
          bloques.push({
            type: 'tool_use',
            id: `tu_${llamada.quien}_${i}_${n}`,
            name: u.name,
            input: u.input,
          } as Anthropic.ContentBlock)
        })
        return mensaje(bloques, 'tool_use')
      }

      emit({ tipo: 'texto', delta: acto.texto })
      emitido.push({ quien: llamada.quien, texto: acto.texto })
      return mensaje([{ type: 'text', text: acto.texto }])
    } finally {
      simultaneas.ahora--
    }
  }

  return { runner, llamadas, simultaneas, emitido }
}

function mensaje(
  content: unknown[],
  stopReason: 'end_turn' | 'tool_use' = 'end_turn',
): Anthropic.Message {
  return {
    id: 'msg_falso',
    type: 'message',
    role: 'assistant',
    model: 'falso',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: USO_FALSO,
  } as unknown as Anthropic.Message
}
