/**
 * Regular el esfuerzo del modelo — donde el modelo lo acepta.
 *
 * `output_config.effort` y `thinking: { type: 'adaptive' }` son de la familia
 * Claude 5 (y de Opus 4.8). **Haiku 4.5 los rechaza**, y no los ignora: la API
 * contesta 400 y la llamada entera se pierde. Verificado contra la API el
 * 2026-08-24:
 *
 *   claude-haiku-4-5 + output_config → «This model does not support the effort parameter.»
 *   claude-haiku-4-5 + adaptive      → «adaptive thinking is not supported on this model»
 *   claude-haiku-4-5 pelado          → OK
 *   claude-sonnet-5 / opus-4-8 / opus-5 con los dos → OK
 *
 * Costó caro. El Operador le pasaba esos dos parámetros a los ocho
 * especialistas del escalón `mecanico`, que corren en Haiku: los ocho morían
 * con 400 en su PRIMERA llamada, antes de gastar un token. Como no llegaban a
 * gastar nada, no dejaban rastro en ningún lado — ni en el gasto por agente, ni
 * en un paso en rojo. El especialista de al lado recibía «no responde por un
 * error técnico», el plan se cerraba con «2 pasos listos», y en pantalla no
 * había pasado nada. Lo mismo mataba al armador de segmentos con IA.
 *
 * Por eso vive en un solo lugar: la lista de modelos cambia, y el precio de
 * equivocarse es una función que no funciona sin que nadie se entere.
 */

/** ¿A este modelo se le puede pedir más o menos esfuerzo? */
export function reguladoPorEsfuerzo(model: string): boolean {
  return !/haiku-4-5/.test(model)
}

/**
 * Los parámetros de esfuerzo listos para desparramar en la llamada, o nada.
 *
 * `pensar` es el modo de razonamiento: `adaptive` deja que el modelo decida
 * cuánto piensa, `disabled` lo apaga para una tarea mecánica.
 */
export function esfuerzo(
  model: string,
  opciones: {
    effort?: 'low' | 'medium' | 'high'
    pensar?: 'adaptive' | 'disabled'
  } = {},
): Record<string, unknown> {
  if (!reguladoPorEsfuerzo(model)) return {}
  return {
    thinking: { type: opciones.pensar ?? 'disabled' },
    output_config: { effort: opciones.effort ?? 'low' },
  }
}

/**
 * El modelo con el que atiende un asistente nuevo.
 *
 * Estuvo clavado en Haiku 4.5 por costo, y hasta el 2026-08-28 fue una
 * decision razonable. Dejo de serlo cuando se midio lo que escribia: con una
 * lista larga de reglas se le escapan las ultimas, y las ultimas eran las que
 * le prohiben afirmar lo que no le consta. Publico "no tenemos aprobacion
 * ANMAT" y "los testimonios son reales" debajo de una foto. Ahi paso a Opus 5.
 *
 * El 2026-09-17 se midio Sonnet 5 contra Opus 5 con el mismo prompt, las
 * mismas herramientas y el mismo bucle, sobre 40 conversaciones reales de
 * Pilar y 12 casos adversariales (ANMAT, ingredientes, cupones, contra
 * entrega, embarazo): una infraccion grave contra dos, mejor nota de venta,
 * la mitad de latencia y 2,5 veces mas barato. El harness queda en
 * `scripts/eval-modelo/` para repetirlo antes de volver a cambiar esto.
 *
 * Un modelo que desobedece la regla numero ocho no sirve para atender en
 * publico, por barato que sea: Haiku sigue afuera. Opus 5 queda como opcion
 * por agente. Se corre con esfuerzo BAJO, que es donde la diferencia de
 * precio se achica y la obediencia se mantiene.
 */
export const MODELO_POR_DEFECTO = 'claude-sonnet-5'
