/**
 * Lo que el chat ve mientras Riverz trabaja.
 *
 * El turno del Operator deja de ser una respuesta y pasa a ser una secuencia:
 * piensa, consulta, construye, contesta. Sin esto, el comercio mira un spinner
 * durante veinte segundos y después le aparece un párrafo — que es exactamente
 * la sensación contraria a "ver cómo lo va armando".
 *
 * Con equipo hay una regla que atraviesa todo el protocolo y conviene leerla
 * antes que nada: **los subagentes no emiten `text`**. El hilo de la
 * conversación lo escribe el orquestador y nadie más. Si cinco subagentes
 * mandaran texto por el mismo canal, sus frases se pegarían dentro del mismo
 * párrafo —la pantalla acumula los deltas en el último bloque, sin saber quién
 * los dijo— y además chocaría con lo que se pidió: respuestas al grano. Lo que
 * dicen los subagentes va por `agente_dice` y se lee en el panel de la derecha,
 * separado por agente.
 *
 * El transporte es NDJSON (un evento JSON por línea) sobre un `fetch` normal, y
 * no SSE: `EventSource` no puede mandar headers, y todo POST de esta aplicación
 * lleva `x-csrf-token`. Con `fetch` + `getReader()` la protección queda intacta.
 */

import type { Artefacto } from './artifacts'
import type { SubagentId } from './fleet/types'

export type OperatorEvent =
  /**
   * Razonamiento del modelo, cuando lo expone.
   *
   * Medido contra la API: `claude-sonnet-5` con `thinking: adaptive` no manda
   * bloques de pensamiento en ningún `display` —se probó `summarized`,
   * `omitted` y sin especificar, cero deltas en los tres—. Razona por dentro y
   * devuelve sólo texto. Lo que ve el comercio como "está pensando" es otra
   * cosa, y es real: el Operator dice en una línea qué va a hacer antes de
   * hacerlo (ver `prompt.ts`), y esa línea llega como `text` antes del primer
   * `tool_start`. Este evento queda porque el manejo ya está escrito y si un
   * modelo futuro los expone, aparecen solos.
   */
  | { t: 'thinking'; delta: string }
  /** La respuesta al comercio, en pedazos. Sólo del orquestador. */
  | { t: 'text'; delta: string }
  /** Empezó a usar una herramienta. `label` ya viene en castellano. */
  | { t: 'tool_start'; id: string; key: string; label: string; agente?: SubagentId }
  /** Terminó de leer algo. */
  | {
      t: 'tool_done'
      id: string
      key: string
      ok: boolean
      resumen: string
      agente?: SubagentId
    }
  /** Dejó algo propuesto: espera un click. */
  | {
      t: 'proposed'
      id: string
      actionId: string
      key: string
      /** El nombre del paso, en castellano. Al correr un plan no hay `tool_start`
       *  que lo haya dicho antes, y sin esto se imprimía la clave cruda. */
      label?: string
      preview: string
      /** Lo mismo, dibujable: el árbol de la automatización, la plantilla. */
      artefacto?: Artefacto
      agente?: SubagentId
    }
  /** Lo construyó de verdad (modo automático, o plan aprobado). */
  | {
      t: 'built'
      id: string
      actionId: string
      key: string
      /** El nombre del paso, en castellano. Al correr un plan no hay `tool_start`
       *  que lo haya dicho antes, y sin esto se imprimía la clave cruda. */
      label?: string
      preview: string
      artefacto?: Artefacto
      agente?: SubagentId
    }
  /** Vuelta N del loop, para poder mostrar que sigue trabajando. */
  | { t: 'step'; n: number; de: number }

  // ── El equipo ──────────────────────────────────────────────────────────

  /**
   * El reparto, antes de que corra nada.
   *
   * Es lo que se aprueba de una sola vez. Se muestra entero para que un reparto
   * equivocado se pueda leer y rechazar, que es lo que permite dejar la
   * decisión de a quién le toca en manos del modelo.
   */
  | {
      t: 'plan'
      planId: string
      /** Por qué en ese orden, en una frase. */
      porque: string
      pasos: {
        i: number
        agente: SubagentId
        /** Qué va a pasar, en castellano. Es lo que se muestra al aprobar. */
        que: string
        encargo: string
        dependeDe: number[]
      }[]
    }
  | {
      t: 'plan_estado'
      planId: string
      estado:
        | 'aprobado'
        | 'rechazado'
        | 'corriendo'
        | 'terminado'
        /** Algo falló y algo salió: no es lo mismo que fallar entero. */
        | 'parcial'
        | 'fallido'
    }
  | { t: 'agente_inicio'; agente: SubagentId; paso?: number; encargo: string }
  /**
   * Lo que dice un subagente, en líneas completas y no en deltas.
   *
   * En el panel se lee "qué está haciendo el equipo", no un párrafo. Con deltas
   * haría falta un reductor por agente y decidir dónde va cada pedazo; con la
   * línea entera el panel sólo agrega a una lista. Y la primera llega temprano
   * igual, porque el prompt obliga a anunciar antes de actuar.
   */
  | { t: 'agente_dice'; agente: SubagentId; texto: string }
  | {
      t: 'agente_fin'
      agente: SubagentId
      paso?: number
      ok: boolean
      resumen: string
      propuestas: number
      construidas: number
    }
  /** Un subagente le encargó algo a otro. Profundidad uno, siempre. */
  | { t: 'agente_pide'; agente: SubagentId; a: SubagentId; texto: string }
  /** Sobre qué está trabajando el equipo ahora mismo, dibujable. */
  | { t: 'lienzo'; agente: SubagentId; paso?: number; artefacto: Artefacto }
  /** Cuánto se gastó, para poder mirarlo en vez de suponerlo. */
  | {
      t: 'gasto'
      promptTokens: number
      completionTokens: number
      porAgente: Record<string, number>
    }
  /**
   * Señal de vida.
   *
   * Un subagente puede tardar un minuto sin emitir nada, y un NDJSON mudo es
   * indistinguible de una conexión cortada: proxies, navegadores y la propia
   * persona asumen lo mismo. Un latido cada diez segundos mantiene el canal
   * abierto y la pantalla honesta.
   */
  | { t: 'latido' }

  | { t: 'error'; message: string }
  | { t: 'done'; thread: string }

/** Una línea de NDJSON, con el salto incluido. */
export function encodeEvent(e: OperatorEvent): string {
  return `${JSON.stringify(e)}\n`
}

/**
 * Parte un buffer en eventos completos y devuelve lo que quedó a medias.
 *
 * Un chunk de red puede cortar en cualquier byte, incluso en la mitad de un
 * carácter multibyte o de una llave: sin guardar el resto, una tilde partida en
 * dos chunks rompe el JSON y se pierde el evento.
 */
export function drainEvents(buffer: string): {
  events: OperatorEvent[]
  rest: string
} {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  const events: OperatorEvent[] = []
  for (const line of parts) {
    const s = line.trim()
    if (!s) continue
    try {
      events.push(JSON.parse(s) as OperatorEvent)
    } catch {
      // Una línea ilegible no puede cortar el resto del turno.
    }
  }
  return { events, rest }
}

export type EmitFn = (e: OperatorEvent) => void
