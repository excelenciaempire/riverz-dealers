/**
 * El único camino por el que algo cambia en la cuenta.
 *
 * Vivía adentro del loop del orquestador, y ahí estaba bien mientras el
 * orquestador era el único que escribía. Con equipo hay catorce subagentes que
 * también van a llamar capacidades, y si cada uno escribiera a su manera se
 * perdería lo que hace confiable a todo esto: que el `preview` describa lo que
 * de verdad va a pasar, que el artefacto se calcule desde los argumentos y no
 * desde lo que diga el modelo, y que quede una fila en `operator_actions` sin
 * importar el modo ni quién lo pidió.
 *
 * Dos caminos y nada más:
 *
 *  - `proponer` deja la fila esperando un click. El modelo recibe "quedó
 *    propuesto", no un resultado, así que una instrucción hostil escondida en
 *    el mensaje de un cliente no puede cambiar nada.
 *  - `construir` ejecuta. Se llega acá sólo con algo inerte —que queda
 *    apagado— y con el modo automático prendido o dentro de un plan aprobado.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { findCapability } from '@/lib/capabilities/registry'
import type { CapabilityContext } from '@/lib/capabilities/types'
import type { Artefacto } from './artifacts'
import { conDiff } from './artifacts-diff'

/** Cuánto del resultado se le devuelve al modelo. */
const TOPE_RESULTADO = 20_000

export interface Escritura {
  id: string
  preview: string | null
  artefacto: Artefacto | null
  /** Lo que se le contesta al modelo, como texto de `tool_result`. */
  texto: string
  /**
   * Lo que devolvió la capacidad, crudo.
   *
   * Sólo cuando se ejecutó. Lo necesita el pizarrón de hechos: los datos que
   * viajan al paso siguiente —el nombre exacto de la plantilla recién creada,
   * por ejemplo— salen de ACÁ y no de los argumentos. No es lo mismo: los
   * argumentos son lo que se pidió, el resultado es lo que quedó, y cuando el
   * servidor normaliza un nombre o resuelve un id, son distintos.
   */
  resultado?: unknown
}

/**
 * El dibujo de lo que se va a hacer, si la capacidad sabe producirlo.
 *
 * Nunca puede tumbar la operación: es lo que se muestra, no lo que se hace.
 *
 * Cuando la capacidad además sabe decir cómo está la cosa HOY, el dibujo sale
 * marcado con el diff. Es lo que convierte "actualizá el carrito abandonado"
 * de un árbol que hay que comparar de memoria en un árbol donde se ve qué se
 * movió.
 */
export async function artefactoDe(
  cap: ReturnType<typeof findCapability>,
  ctx: CapabilityContext,
  args: Record<string, unknown>,
  result?: unknown,
): Promise<Artefacto | null> {
  try {
    const nuevo = cap?.artifact?.(ctx, args, result) ?? null
    if (!nuevo) return null
    const previo = cap?.artifactBefore ? await cap.artifactBefore(ctx, args) : null
    return conDiff(previo, nuevo)
  } catch {
    return null
  }
}

/**
 * Anota una acción que cambia algo y devuelve qué contestarle al modelo.
 *
 * El `preview` se calcula en el servidor y no lo escribe el modelo: es lo que
 * la persona va a leer antes de aprobar, así que tiene que describir lo que
 * realmente se va a ejecutar.
 */
/**
 * Sobre qué objeto trabaja una llamada: su nombre, su id, lo que la identifica.
 *
 * Es lo que decide si dos propuestas son la misma cosa. Sin ninguno de estos
 * campos no se puede saber, y ahí no se deduplica: mejor dos filas que comerse
 * una propuesta distinta.
 */
function objetoDe(args: Record<string, unknown>): string | null {
  for (const campo of ['nombre', 'id', 'automatizacion', 'plantilla', 'agente']) {
    const v = args[campo]
    if (typeof v === 'string' && v.trim()) return `${campo}:${v.trim().toLowerCase()}`
  }
  return null
}

export async function proponer(
  ctx: CapabilityContext,
  threadId: string,
  key: string,
  args: Record<string, unknown>,
): Promise<Escritura> {
  const cap = findCapability(key)!
  // Si la capacidad no puede describir lo que haría, no hay nada que aprobar.
  //
  // Esto se tragaba el error y guardaba el motivo COMO vista previa, así que
  // aparecía una tarjeta que decía «No se puede: …» con un botón de aprobar
  // debajo. Quien la miraba no tenía forma de saber que ese botón no iba a
  // hacer nada. Dejándolo pasar, el error vuelve al modelo —los dos llamadores
  // lo convierten en `tool_result` con `is_error`— y corrige los argumentos.
  const preview: string | null = cap.preview ? await cap.preview(ctx, args) : null

  // Se dibuja desde los argumentos: la persona ve el árbol ANTES de aprobar,
  // que es cuando le sirve.
  const artefacto = await artefactoDe(cap, ctx, args)

  /**
   * Si ya hay una igual esperando, es ésa.
   *
   * Se vio en una cuenta real: se pidió corregir dos de tres mensajes, el
   * especialista volvió a escribir los tres, y la tarjeta pasó a pedir SEIS
   * aprobaciones para tres mensajes. Que el modelo recuerde lo que propuso
   * ataca la causa; esto sostiene la consecuencia pase lo que pase, que es lo
   * que hace falta cuando del otro lado hay un modelo.
   *
   * La comparación es por objeto y no por argumentos enteros a propósito:
   * proponer «recompra_1» con el cuerpo corregido ES la misma propuesta, con
   * el texto nuevo, y hacer dos filas de eso es justo lo que se quiere evitar.
   */
  const cual = objetoDe(args)
  if (cual) {
    const { data: yaHay } = await ctx.db
      .from('operator_actions')
      .select('id, args')
      .eq('workspace_id', ctx.workspaceId)
      .eq('thread_id', threadId)
      .eq('capability_key', key)
      .eq('status', 'propuesto')
    const previa = ((yaHay ?? []) as Array<{ id: string; args: Record<string, unknown> }>).find(
      (f) => objetoDe(f.args) === cual,
    )
    if (previa) {
      // Se actualiza con lo último: el cuerpo corregido es lo que hay que
      // mirar, y la fila vieja tendría el texto de antes.
      await ctx.db
        .from('operator_actions')
        .update({ args, preview, artifact: artefacto })
        .eq('id', previa.id)
      return {
        id: previa.id,
        preview,
        artefacto,
        texto: JSON.stringify({
          propuesto: true,
          action_id: previa.id,
          nota: 'Ya había una propuesta igual esperando: se actualizó con esto en vez de agregar otra. NO está hecho.',
          preview,
        }),
      }
    }
  }

  const { data, error } = await ctx.db
    .from('operator_actions')
    .insert({
      workspace_id: ctx.workspaceId,
      thread_id: threadId,
      capability_key: key,
      args,
      risk: cap.risk,
      preview,
      artifact: artefacto,
      status: 'propuesto',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  const id = (data as { id: string }).id
  return {
    id,
    preview,
    artefacto,
    texto: JSON.stringify({
      propuesto: true,
      action_id: id,
      // Decía «Explicá qué haría y qué riesgo tiene»: voseo, y encima pedía
      // justo lo que la tarjeta ya muestra. Es la nota que el modelo lee en
      // CADA propuesta, así que de acá salía la mitad de los cierres que
      // enumeraban lo propuesto y terminaban en «esperando aprobación».
      nota: 'Quedó propuesto. NO está hecho. La tarjeta ya muestra qué es y tiene los botones: no la describas. Si algo de esto tiene un riesgo que la tarjeta no dice, ésa es tu única línea.',
      preview,
    }),
  }
}

/**
 * Construye ahora y deja el registro.
 *
 * Sólo se llega acá con algo inerte y con permiso: el modo automático prendido,
 * o un plan que una persona ya aprobó. La fila en `operator_actions` se escribe
 * igual, ya ejecutada: la pregunta "¿qué me hizo el Operador?" se contesta en el
 * mismo lugar sin importar el modo, y sin eso el modo automático sería el que
 * no deja rastro.
 */
export async function construir(
  ctx: CapabilityContext,
  threadId: string,
  key: string,
  args: Record<string, unknown>,
): Promise<Escritura> {
  const cap = findCapability(key)!
  let preview: string | null = null
  try {
    preview = cap.preview ? await cap.preview(ctx, args) : null
  } catch {
    preview = null
  }

  // El "antes" se calcula ANTES de ejecutar, o el diff compararía el resultado
  // contra sí mismo y no marcaría nada.
  let previo: Artefacto | null = null
  try {
    previo = cap.artifactBefore ? await cap.artifactBefore(ctx, args) : null
  } catch {
    previo = null
  }

  const salida = await cap.run(ctx, args)

  let artefacto: Artefacto | null = null
  try {
    const nuevo = cap.artifact?.(ctx, args, salida) ?? null
    artefacto = nuevo ? conDiff(previo, nuevo) : null
  } catch {
    artefacto = null
  }

  const { data } = await ctx.db
    .from('operator_actions')
    .insert({
      workspace_id: ctx.workspaceId,
      thread_id: threadId,
      capability_key: key,
      args,
      risk: cap.risk,
      preview,
      artifact: artefacto,
      status: 'ejecutado',
      result: salida ?? null,
      approved_by: ctx.actor.id ?? null,
      executed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  return {
    id: (data as { id: string } | null)?.id ?? '',
    preview,
    artefacto,
    texto: JSON.stringify({ hecho: true, resultado: salida }).slice(0, TOPE_RESULTADO),
    resultado: salida,
  }
}

/**
 * El resultado de una lectura, recortado para que no reviente el contexto.
 *
 * Ojo, no confundir con `resumirSalida` del loop: aquélla arma una etiqueta
 * corta para la pantalla ("9 filas"), ésta recorta el JSON que vuelve al
 * modelo.
 */
export function recortarResultado(salida: unknown): string {
  return JSON.stringify(salida ?? null).slice(0, TOPE_RESULTADO)
}

export type { SupabaseClient }
