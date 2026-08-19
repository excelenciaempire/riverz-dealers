/**
 * Lo que el chat ve mientras Riverz trabaja.
 *
 * El turno del Operator deja de ser una respuesta y pasa a ser una secuencia:
 * piensa, consulta, construye, contesta. Sin esto, el comercio mira un spinner
 * durante veinte segundos y después le aparece un párrafo — que es exactamente
 * la sensación contraria a "ver cómo lo va armando".
 *
 * El transporte es NDJSON (un evento JSON por línea) sobre un `fetch` normal, y
 * no SSE: `EventSource` no puede mandar headers, y todo POST de esta aplicación
 * lleva `x-csrf-token`. Con `fetch` + `getReader()` la protección queda intacta.
 */

export type OperatorEvent =
  /**
   * Razonamiento del modelo, cuando lo expone.
   *
   * Medido contra la API: `claude-sonnet-5` con `thinking: adaptive` no manda
   * bloques de pensamiento ni en effort medio ni alto — razona por dentro y
   * devuelve sólo texto. Lo que ve el comercio como "está pensando" es otra
   * cosa, y es real: el Operator dice en una línea qué va a hacer antes de
   * hacerlo (ver `prompt.ts`), y esa línea llega como `text` antes del primer
   * `tool_start`. Este evento queda porque el manejo ya está escrito y si un
   * modelo futuro los expone, aparecen solos.
   */
  | { t: 'thinking'; delta: string }
  /** La respuesta al comercio, en pedazos. */
  | { t: 'text'; delta: string }
  /** Empezó a usar una herramienta. `label` ya viene en castellano. */
  | { t: 'tool_start'; id: string; key: string; label: string }
  /** Terminó de leer algo. */
  | { t: 'tool_done'; id: string; key: string; ok: boolean; resumen: string }
  /** Dejó algo propuesto: espera un click. */
  | { t: 'proposed'; id: string; actionId: string; key: string; preview: string }
  /** Lo construyó de verdad (modo automático). */
  | { t: 'built'; id: string; actionId: string; key: string; preview: string }
  /** Vuelta N del loop, para poder mostrar que sigue trabajando. */
  | { t: 'step'; n: number; de: number }
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
