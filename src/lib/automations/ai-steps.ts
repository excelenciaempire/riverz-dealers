/**
 * Cómo describe el Operador una automatización que quiere crear.
 *
 * No es JSON libre. El modelo emite un árbol de pasos acotado, con enums
 * cerrados, y esto lo valida ANTES de tocar la base — el mismo criterio que
 * `ai-patches.ts` usa para los flujos, y por la misma razón: un `step_type`
 * inventado o una condición sin sujeto se guardan sin quejarse y después
 * fallan en cada corrida con un error críptico en los registros, cuando ya es
 * de noche y le está escribiendo a clientes.
 *
 * El conjunto de pasos que se expone es DELIBERADAMENTE más chico que el que
 * soporta el motor. Quedan afuera los que necesitan un id que el modelo no
 * puede conocer (asignar a un agente, webhooks, llamadas de voz): mejor que
 * diga "eso todavía no lo puedo armar" a que invente un uuid.
 */
import type { AutomationTriggerType } from '@/types'
import type { BuilderStepInput } from './steps-tree'
import { activationIssues } from './activation'
import type { ValidationIssue } from './validate'

/** Los pasos que el Operador puede armar. */
export const AI_STEP_TYPES = [
  'send_message',
  'send_template',
  'wait',
  'add_tag',
  'condition',
  'close_conversation',
] as const

export type AiStepType = (typeof AI_STEP_TYPES)[number]

/** Los disparadores que puede elegir, con nombre entendible. */
export const AI_TRIGGERS: { value: AutomationTriggerType; que: string }[] = [
  { value: 'shopify_abandoned_checkout', que: 'alguien dejó un carrito sin comprar' },
  { value: 'shopify_order_created', que: 'entró un pedido nuevo' },
  { value: 'shopify_order_paid', que: 'se pagó un pedido' },
  { value: 'shopify_order_fulfilled', que: 'salió el envío de un pedido' },
  { value: 'shopify_order_delivered', que: 'se entregó un pedido' },
  { value: 'shopify_order_cancelled', que: 'se canceló un pedido' },
  { value: 'shopify_order_refunded', que: 'se reembolsó un pedido' },
  { value: 'payment_rejected', que: 'rechazaron un pago' },
  { value: 'first_inbound_message', que: 'alguien escribe por primera vez' },
  { value: 'new_contact_created', que: 'se creó un contacto nuevo' },
  { value: 'customer_inactive', que: 'un cliente lleva días sin comprar' },
  { value: 'post_delivery_feedback', que: 'pasaron días desde la entrega' },
]

/**
 * El esquema que ve el modelo.
 *
 * Un solo nivel de anidamiento en las condiciones: el motor soporta más, pero
 * un árbol profundo escrito a ciegas es imposible de revisar de un vistazo, y
 * la persona que aprueba tiene que poder entenderlo.
 */
const PASO_BASE = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: [...AI_STEP_TYPES] },
    texto: { type: 'string', description: 'Para tipo=send_message. Admite {{nombre}}.' },
    plantilla: {
      type: 'string',
      description: 'Para tipo=send_template: el nombre exacto de una plantilla aprobada.',
    },
    etiqueta: { type: 'string', description: 'Para tipo=add_tag: el nombre de la etiqueta.' },
    cantidad: { type: 'number', description: 'Para tipo=wait.' },
    unidad: { type: 'string', enum: ['minutes', 'hours', 'days'] },
    sujeto: {
      type: 'string',
      description: 'Para tipo=condition, p. ej. "order_paid" o "tag".',
    },
    operando: { type: 'string', description: 'El complemento del sujeto, si lleva.' },
  },
  required: ['tipo'],
} as const

export const AI_STEPS_SCHEMA = {
  type: 'object' as const,
  properties: {
    nombre: { type: 'string' },
    disparador: { type: 'string', enum: AI_TRIGGERS.map((x) => x.value) },
    pasos: {
      type: 'array',
      items: {
        ...PASO_BASE,
        properties: {
          ...PASO_BASE.properties,
          si: { type: 'array', items: PASO_BASE, description: 'Pasos si la condición da que sí.' },
          no: { type: 'array', items: PASO_BASE, description: 'Pasos si da que no.' },
        },
      },
    },
  },
  required: ['nombre', 'disparador', 'pasos'],
}

export interface AiPaso {
  tipo: string
  texto?: string
  plantilla?: string
  etiqueta?: string
  cantidad?: number
  unidad?: string
  sujeto?: string
  operando?: string
  si?: AiPaso[]
  no?: AiPaso[]
}

/** Traduce un paso del modelo a lo que entiende el constructor. */
function aPaso(p: AiPaso): BuilderStepInput | null {
  switch (p.tipo) {
    case 'send_message':
      return p.texto ? { step_type: 'send_message', step_config: { text: p.texto } } : null
    case 'send_template':
      return p.plantilla
        ? { step_type: 'send_template', step_config: { template_name: p.plantilla } }
        : null
    case 'wait':
      return typeof p.cantidad === 'number' && p.unidad
        ? { step_type: 'wait', step_config: { amount: p.cantidad, unit: p.unidad } }
        : null
    case 'add_tag':
      // El id real de la etiqueta lo resuelve `resolverEtiquetas` contra la
      // cuenta: acá viaja el nombre, que es lo único que el modelo puede saber.
      return p.etiqueta
        ? { step_type: 'add_tag', step_config: { tag_id: p.etiqueta } }
        : null
    case 'close_conversation':
      return { step_type: 'close_conversation', step_config: {} }
    case 'condition': {
      if (!p.sujeto) return null
      return {
        step_type: 'condition',
        step_config: { subject: p.sujeto, operand: p.operando ?? '' },
        branches: {
          yes: (p.si ?? []).map(aPaso).filter((x): x is BuilderStepInput => x !== null),
          no: (p.no ?? []).map(aPaso).filter((x): x is BuilderStepInput => x !== null),
        },
      }
    }
    default:
      return null
  }
}

export interface PlanAutomatizacion {
  nombre: string
  disparador: AutomationTriggerType
  pasos: BuilderStepInput[]
}

/**
 * Convierte lo que dijo el modelo, o explica por qué no se puede.
 *
 * Devolver los problemas en vez de tirar es a propósito: el modelo puede
 * corregir y volver a intentar en la misma vuelta, y la persona ve qué faltaba
 * en vez de un fallo mudo.
 */
export function planDesdeIA(entrada: {
  nombre?: string
  disparador?: string
  pasos?: AiPaso[]
}): { plan: PlanAutomatizacion | null; problemas: ValidationIssue[] } {
  const problemas: ValidationIssue[] = []
  const nombre = (entrada.nombre ?? '').trim()
  if (!nombre) problemas.push({ path: 'nombre', message: 'falta el nombre' })

  const disparador = entrada.disparador as AutomationTriggerType
  if (!AI_TRIGGERS.some((x) => x.value === disparador)) {
    problemas.push({ path: 'disparador', message: `disparador no soportado: ${entrada.disparador}` })
  }

  const crudos = Array.isArray(entrada.pasos) ? entrada.pasos : []
  const pasos = crudos.map(aPaso).filter((x): x is BuilderStepInput => x !== null)
  if (pasos.length !== crudos.length) {
    problemas.push({
      path: 'pasos',
      message: 'algún paso venía incompleto (falta el texto, la plantilla, la espera o el sujeto)',
    })
  }
  if (pasos.length === 0) problemas.push({ path: 'pasos', message: 'no hay ningún paso' })

  if (problemas.length > 0) return { plan: null, problemas }

  // La misma puerta que cruza el editor: si esto no pasa, la automatización no
  // se va a poder prender nunca y crearla así sería crear algo muerto.
  //
  // La etiqueta se valida DESPUÉS de resolverse contra la cuenta (acá viaja el
  // nombre, no el uuid), así que ese problema se ignora en esta pasada.
  const issues = activationIssues({
    triggerType: disparador,
    triggerConfig: {},
    steps: pasos as never,
  }).filter((i) => !i.path.endsWith('.tag_id'))

  if (issues.length > 0) return { plan: null, problemas: issues }
  return { plan: { nombre, disparador, pasos }, problemas: [] }
}
