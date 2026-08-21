import type { Artefacto } from './artifacts'
import type { OperatorEvent } from './events'

/**
 * El turno en el orden en que pasó.
 *
 * Texto y pasos van en UNA lista y no en dos, porque se intercalan: el Operator
 * dice qué va a hacer, lo hace, cuenta lo que encontró, hace otra cosa. Con
 * listas separadas, la frase "voy a mirar cómo viene la cuenta" terminaba
 * debajo de la consulta que anunciaba.
 *
 * Vive acá y no en la pantalla porque ahora lo arman los DOS: el navegador
 * mientras el turno ocurre, y el servidor para guardarlo. Sin eso, al recargar
 * una conversación el hilo volvía sin pasos y todas las acciones del historial
 * caían amontonadas al final, lejos del momento en que ocurrieron.
 */
export type Bloque =
  | { k: 'texto'; id: string; texto: string }
  | {
      k: 'paso'
      id: string
      key: string
      /** Lo que manda el servidor, por si la capacidad no tiene etiqueta corta. */
      label: string
      // `ok` es una lectura que salió bien; `hecho` es algo que se construyó de
      // verdad. Se ven distinto a propósito: una cosa es que haya mirado y otra
      // que haya creado.
      estado: 'corriendo' | 'ok' | 'error' | 'propuesto' | 'hecho'
      detalle?: string
      /**
       * La fila de `operator_actions`, cuando el paso dejó una.
       *
       * Es lo que permite que el hilo no mienta después de aprobar: sin esto,
       * el paso queda congelado en "propuesto" para siempre y abajo aparece la
       * misma cosa otra vez diciendo "Hecho".
       */
      actionId?: string
      /** Lo que se armó, dibujable. */
      artefacto?: Artefacto
    }

/** Suma un delta de texto al último bloque, o abre uno nuevo si venía un paso. */
export function conTexto(bloques: Bloque[], delta: string): Bloque[] {
  const ultimo = bloques[bloques.length - 1]
  if (ultimo?.k === 'texto') {
    return [...bloques.slice(0, -1), { ...ultimo, texto: ultimo.texto + delta }]
  }
  return [...bloques, { k: 'texto', id: `t${bloques.length}`, texto: delta }]
}

/** Cambia el estado de un paso ya abierto, dejándolo donde está. */
export function conPaso(
  bloques: Bloque[],
  id: string,
  patch: Partial<Extract<Bloque, { k: 'paso' }>>,
): Bloque[] {
  return bloques.map((b) => (b.k === 'paso' && b.id === id ? { ...b, ...patch } : b))
}

/**
 * Un evento del stream, aplicado al turno.
 *
 * Devuelve la lista nueva. Los eventos que no dibujan nada en el hilo —el
 * pensamiento, el latido, todo lo del equipo— la devuelven igual.
 */
export function aplicarEvento(bloques: Bloque[], e: OperatorEvent): Bloque[] {
  switch (e.t) {
    case 'text':
      return conTexto(bloques, e.delta)
    case 'tool_start':
      return [...bloques, { k: 'paso', id: e.id, key: e.key, label: e.label, estado: 'corriendo' }]
    case 'tool_done':
      return conPaso(bloques, e.id, {
        estado: e.ok ? 'ok' : 'error',
        detalle: e.ok ? undefined : e.resumen,
      })
    case 'proposed':
      return conPaso(bloques, e.id, {
        estado: 'propuesto',
        detalle: e.preview,
        artefacto: e.artefacto,
        actionId: e.actionId,
      })
    case 'built':
      return conPaso(bloques, e.id, {
        estado: 'hecho',
        detalle: e.preview,
        artefacto: e.artefacto,
        actionId: e.actionId,
      })
    default:
      return bloques
  }
}

/**
 * Un grabador para el servidor: mira pasar los eventos y arma el turno.
 *
 * Todos los eventos salen por una sola función `push`, así que envolverla con
 * esto deja los bloques listos para guardar sin repetir la lógica de la
 * pantalla — y sin que las dos puedan quedar distintas, que es lo que haría
 * que el hilo se viera de una forma en vivo y de otra al recargarlo.
 */
export function grabador() {
  let bloques: Bloque[] = []
  return {
    ver(e: OperatorEvent) {
      bloques = aplicarEventoDePlan(bloques, e)
    },
    get bloques() {
      return bloques
    },
  }
}

/**
 * Los pasos que quedan en un plan aprobado no traen `tool_start`.
 *
 * Cuando se corre un plan, el servidor emite `proposed`/`built` sin haber
 * abierto el paso antes, así que `conPaso` no encuentra a quién parchear. Acá
 * se abre el paso en el momento, con la etiqueta que ya viene en el evento.
 */
export function aplicarEventoDePlan(bloques: Bloque[], e: OperatorEvent): Bloque[] {
  if ((e.t === 'proposed' || e.t === 'built') && !bloques.some((b) => b.k === 'paso' && b.id === e.id)) {
    const abierto: Bloque[] = [
      ...bloques,
      { k: 'paso', id: e.id, key: e.key, label: e.label ?? e.key, estado: 'corriendo' },
    ]
    return aplicarEvento(abierto, e)
  }
  return aplicarEvento(bloques, e)
}
