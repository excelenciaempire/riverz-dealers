/**
 * La única costura entre el equipo y el modelo.
 *
 * Hasta acá `transmitir()` era el único lugar del Operador que tocaba el SDK, y
 * eso ya era una buena propiedad sin que nadie la aprovechara. Se la promueve a
 * interfaz por dos razones que se refuerzan:
 *
 *  1. **Se puede probar sin gastar saldo.** Reparto, olas, concurrencia,
 *     presupuesto, orden de eventos y fallo parcial son lógica nuestra, no del
 *     modelo. Con un runner falso se prueban de verdad, determinísticamente y
 *     gratis. Sin esta costura, cada prueba sería una llamada pagada y de
 *     resultado distinto cada vez.
 *  2. **El gasto queda atribuido por construcción.** `quien` es obligatorio: si
 *     alguien agrega una llamada nueva al modelo y no dice de quién es, no
 *     compila. Es la única forma de que el desglose por subagente no se
 *     desactualice sin que nadie lo note.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { esfuerzo } from '@/lib/ai/esfuerzo'
import { secureSystemPrompt, UNTRUSTED_CONTENT_POLICY } from '@/lib/ai/input-security'
import type { Quien } from './types'

export interface LlamadaModelo {
  /**
   * Quién llama. NO viaja a la API: sirve para atribuir el gasto, para trazar
   * en la mesa de trabajo, y para que el runner falso sepa qué guion seguir.
   */
  quien: Quien
  model: string
  /** Texto plano, o bloques cuando hace falta marcar el corte del caché. */
  system: string | Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  tools: Anthropic.Tool[]
  maxTokens: number
  effort: 'low' | 'medium' | 'high'
}

/** Lo que sale mientras el modelo escribe. */
export interface DeltaModelo {
  tipo: 'texto' | 'pensamiento'
  delta: string
}

export type ModelRunner = (
  llamada: LlamadaModelo,
  emit: (d: DeltaModelo) => void,
) => Promise<Anthropic.Message>

/**
 * El runner de verdad.
 *
 * Es `transmitir()` tal como estaba, con el cliente inyectado en vez de
 * construido adentro. El mensaje final trae los bloques completos —incluidos
 * los de pensamiento— y hay que devolverlos tal cual al historial: con
 * razonamiento activado, la API rechaza un turno de herramientas al que le
 * falten.
 */
export function anthropicRunner(client: Anthropic): ModelRunner {
  return async (llamada, emit) => {
    const stream = client.messages.stream({
      model: llamada.model,
      max_tokens: llamada.maxTokens,
      system: typeof llamada.system === 'string'
        ? secureSystemPrompt(llamada.system)
        : [...llamada.system, { type: 'text', text: UNTRUSTED_CONTENT_POLICY }],
      messages: llamada.messages,
      ...(llamada.tools.length > 0 ? { tools: llamada.tools } : {}),
      // Haiku no los acepta y contesta 400: ocho de los catorce especialistas
      // corren ahí. Ver `@/lib/ai/esfuerzo`.
      ...esfuerzo(llamada.model, { effort: llamada.effort, pensar: 'adaptive' }),
    } as Parameters<typeof client.messages.stream>[0])

    for await (const ev of stream) {
      if (ev.type !== 'content_block_delta') continue
      if (ev.delta.type === 'text_delta') emit({ tipo: 'texto', delta: ev.delta.text })
      else if (ev.delta.type === 'thinking_delta') {
        emit({ tipo: 'pensamiento', delta: ev.delta.thinking })
      }
    }

    return stream.finalMessage()
  }
}

/**
 * Con qué modelo trabaja cada uno.
 *
 * El orquestador reparte y redacta lo que se lee: ahí conviene razonar. Un
 * `constructor` arma algo con un schema estrecho y el encargo ya escrito, así
 * que necesita precisión, no más deliberación. Un `mecanico` ejecuta un pedido
 * acotado sobre datos que ya tiene.
 *
 * No sube a Opus a propósito: el cuello de botella de un subagente es acertarle
 * al schema, y para eso alcanza.
 */
export const MODELOS = {
  orquestador: { model: 'claude-sonnet-5', effort: 'medium' as const, maxTokens: 4096 },
  constructor: { model: 'claude-sonnet-5', effort: 'medium' as const, maxTokens: 4096 },
  mecanico: { model: 'claude-sonnet-5', effort: 'low' as const, maxTokens: 2048 },
}
