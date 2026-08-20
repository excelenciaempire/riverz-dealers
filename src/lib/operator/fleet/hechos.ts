/**
 * Lo que un paso le deja al siguiente.
 *
 * El caso que motiva todo esto es el más común de todos: "armá recuperación de
 * carritos" necesita una plantilla aprobada y una automatización que la use. El
 * de plantillas la crea; el de automatizaciones tiene que poner **el nombre
 * exacto** en el paso `send_template`, porque un nombre inventado deja la
 * automatización imposible de activar y nadie se entera hasta que la prende.
 *
 * Se podría dejar que el modelo se pase el nombre en el texto. No: es
 * exactamente el lugar donde un modelo alucina un nombre parecido. Así que los
 * datos duros los saca el SERVIDOR del resultado real de la capacidad, con un
 * switch por clave, y viajan aparte del texto. Misma regla que el `preview` y
 * el artefacto: lo que se pasa describe lo que de verdad pasó.
 */
import type { Hecho, SubagentId } from './types'

/** Cuánto texto de un hecho viaja al paso siguiente. */
const TOPE_RESUMEN = 240

/**
 * Los datos duros que deja una capacidad ejecutada.
 *
 * Lo que no está acá, no viaja. Es a propósito: un `refs` con todo el resultado
 * adentro sería el resultado otra vez, y el punto es que el paso siguiente
 * reciba tres datos y no un volcado.
 */
export function refsDe(key: string, result: unknown): Record<string, string> {
  if (!result || typeof result !== 'object') return {}
  const r = result as Record<string, unknown>
  const s = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null

  const out: Record<string, string> = {}
  const poner = (k: string, v: unknown) => {
    const x = s(v)
    if (x) out[k] = x
  }

  switch (key) {
    case 'automatizaciones.crear':
    case 'automatizaciones.crear_desde_receta':
      poner('automatizacion_id', r.id)
      poner('automatizacion', r.nombre ?? r.name)
      break
    case 'automatizaciones.activar':
      poner('automatizacion_id', r.id)
      poner('activa', r.activa)
      break
    case 'plantillas.crear':
    case 'plantillas.crear_borrador':
      // El nombre exacto es el dato: `send_template` no acepta otra cosa.
      poner('plantilla', r.nombre ?? r.name)
      poner('plantilla_estado', r.estado ?? r.status)
      break
    case 'segmentos.crear':
      poner('segmento_id', r.id)
      poner('segmento', r.nombre ?? r.name)
      poner('alcance', r.alcanza ?? r.alcance)
      break
    case 'segmentos.calcular':
      poner('alcance', r.cuantos)
      break
    case 'contactos.etiquetar':
      poner('etiqueta', r.etiqueta)
      poner('alcanzados', r.alcanzados)
      break
    case 'agentes.crear_borrador':
      poner('agente_id', r.id)
      poner('agente', r.nombre ?? r.name)
      poner('rol', r.rol ?? r.role)
      break
    case 'campanas.crear':
      poner('campana_id', r.id)
      poner('campana', r.nombre ?? r.name)
      poner('destinatarios', r.destinatarios)
      break
    case 'flujos.crear':
    case 'flujos.editar':
      poner('flujo_id', r.id)
      poner('flujo', r.nombre ?? r.name)
      break
    default:
      // Sin entrada, no viaja nada. Es lo correcto: un dominio nuevo que
      // todavía no declaró qué deja no debería filtrar su resultado entero.
      break
  }
  return out
}

/** Junta los `refs` de todo lo que hizo un subagente en su turno. */
export function refsDeVarias(
  ejecutadas: Array<{ key: string; result: unknown }>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of ejecutadas) Object.assign(out, refsDe(e.key, e.result))
  return out
}

export function armarHecho(
  de: SubagentId,
  resumen: string,
  refs: Record<string, string>,
): Hecho {
  const limpio = resumen.replace(/\s+/g, ' ').trim().slice(0, TOPE_RESUMEN)
  return Object.keys(refs).length > 0
    ? { de, resumen: limpio, refs }
    : { de, resumen: limpio }
}
