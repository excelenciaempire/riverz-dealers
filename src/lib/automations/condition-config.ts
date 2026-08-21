import {
  conditionDataPoints,
  dataPointById,
  type DataPoint,
  type DataPointScope,
} from './data-points'
import type { AutomationTriggerType } from '@/types'

/**
 * La traducción entre "qué dato mira esta pregunta" y la condición que corre.
 *
 * Vive acá y no adentro del lienzo por una razón que costó una automatización
 * rota en una cuenta real: **el lienzo nunca le pide a nadie un `subject`.** Le
 * pide un DATO de una lista cerrada y él arma el `{subject, operand, op,
 * value}`. El Operador, en cambio, escribía el `subject` a mano, y escribió
 * `"tag"` — que no existe. El motor no lo reconoce, contesta que no siempre, y
 * la automatización no le escribió nunca a nadie sin un solo error en ningún
 * lado.
 *
 * Con esta función compartida el error deja de ser posible: los dos entran por
 * la misma puerta. Si mañana alguien suma un dato al registro, el chat lo ve el
 * mismo día que el lienzo.
 *
 * Es un módulo sin React a propósito, como `switch-compile.ts`: así lo puede
 * usar el servidor y se prueba en el runner de node.
 */

/** Los comparadores que ofrece el selector para un dato numérico o de texto. */
export const OPS_CONDICION = ['eq', 'gte', 'lte', 'gt', 'lt', 'between'] as const

export type OpCondicion = (typeof OPS_CONDICION)[number]

/** El dato "horario", que no está en el registro porque no lo trae ningún webhook. */
export const TIME_DP_ID = 'time_of_day'

/** El comparador por defecto al elegir un dato. Vacío = ese dato no se compara. */
export function opPorDefecto(dp: DataPoint): OpCondicion | undefined {
  return dp.condition.kind === 'var' || dp.condition.kind === 'contact_field'
    ? 'eq'
    : undefined
}

/** Los comparadores válidos para un dato. Vacío = no lleva. */
export function opsDe(dp: DataPoint): readonly OpCondicion[] {
  return opPorDefecto(dp) ? OPS_CONDICION : []
}

/** De una condición guardada, de vuelta al dato del registro. */
export function datoDeCfg(
  subject: string | undefined,
  operand: string | undefined,
  dps: DataPoint[],
): string | undefined {
  if (subject === 'time_of_day') return TIME_DP_ID
  return dps.find((d) => {
    const c = d.condition
    if (subject === 'context_var') return c.kind === 'var' && c.varKey === operand
    if (subject === 'contact_field') return c.kind === 'contact_field' && c.column === operand
    if (subject === 'tag_presence') return c.kind === 'tag'
    if (subject === 'in_segment') return c.kind === 'segment'
    if (subject === 'message_content') return c.kind === 'message'
    if (subject === 'purchased') return c.kind === 'purchased'
    if (subject === 'messaged') return c.kind === 'messaged'
    if (subject === 'rejected_open') return c.kind === 'rejected_open'
    if (subject === 'order_paid') return c.kind === 'order_paid'
    return false
  })?.id
}

/**
 * La condición de un dato recién elegido.
 *
 * `value: 'false'` en las preguntas de sí/no no es un error: en el lienzo pone
 * el camino común a la izquierda ("¿NO compró? → mandale el mensaje"), que es
 * como se lee mejor arrastrando cajas. El Operador usa siempre `'true'` y
 * cuelga los pasos de la rama que corresponda — un modelo no gana nada
 * invirtiendo la pregunta y era justo el campo que confundía.
 */
export function cfgDeDato(dp: DataPoint): Record<string, unknown> {
  const c = dp.condition
  if (c.kind === 'var')
    return {
      subject: 'context_var',
      operand: c.varKey,
      op: opPorDefecto(dp),
      value: '',
      value2: undefined,
    }
  if (c.kind === 'contact_field')
    return {
      subject: 'contact_field',
      operand: c.column,
      op: opPorDefecto(dp),
      value: '',
      value2: undefined,
    }
  if (c.kind === 'tag')
    return { subject: 'tag_presence', operand: '', op: undefined, value: '', value2: undefined }
  if (c.kind === 'segment')
    return { subject: 'in_segment', operand: '', op: undefined, value: '', value2: undefined }
  // `operand` es la ventana y `value` el lado que se quiere.
  if (c.kind === 'purchased')
    return {
      subject: 'purchased',
      operand: 'since_trigger',
      op: undefined,
      value: 'false',
      value2: undefined,
    }
  if (c.kind === 'messaged')
    return {
      subject: 'messaged',
      operand: 'since_trigger',
      op: undefined,
      value: 'false',
      value2: undefined,
    }
  if (c.kind === 'rejected_open')
    return {
      subject: 'rejected_open',
      operand: '48h',
      op: undefined,
      value: 'false',
      value2: undefined,
    }
  // Sin ventana: la pregunta es por el pedido de ESTE flujo, no por un plazo.
  if (c.kind === 'order_paid')
    return {
      subject: 'order_paid',
      operand: undefined,
      op: undefined,
      value: 'false',
      value2: undefined,
    }
  return { subject: 'message_content', operand: '', value: '', op: undefined, value2: undefined }
}

/** ¿Ese dato existe cuando dispara esto? */
export function datoUsable(
  id: string,
  trigger: AutomationTriggerType,
  scope?: DataPointScope,
): boolean {
  if (id === TIME_DP_ID) return true
  return conditionDataPoints(trigger, scope).some((d) => d.id === id)
}

/** El dato, por su id. `undefined` para el horario, que no está en el registro. */
export function datoPorId(id: string): DataPoint | undefined {
  return id === TIME_DP_ID ? undefined : dataPointById(id)
}
