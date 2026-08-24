/**
 * Cómo describe el Operador una automatización que quiere crear.
 *
 * **El modelo no escribe condiciones: elige DATOS.** Esa es la decisión que
 * ordena todo el archivo, y salió de una automatización rota en una cuenta
 * real. El esquema viejo pedía un `sujeto` de texto libre cuya descripción
 * decía *«p. ej. "order_paid" o "tag"»*; el modelo escribió `"tag"`, que no
 * existe. El motor no lo reconoce, cae a su `default: return false`, y las tres
 * preguntas de una automatización de recompra dieron siempre que no: nunca le
 * escribió a nadie, sin un solo error en ningún lado.
 *
 * El lienzo nunca tuvo ese problema porque nunca pidió un `subject`: pide un
 * dato de una lista cerrada y él arma la condición (`condition-config.ts`).
 * Acá se entra por esa misma puerta, con el mismo registro `DATA_POINTS`. El
 * error deja de ser posible por construcción, no por chequeo — y el día que
 * alguien sume un dato al registro, el chat lo ve el mismo día que el lienzo.
 *
 * Lo que sí valida esto, antes de tocar la base: que el dato exista PARA ESE
 * disparador, que el comparador tenga sentido para ese dato, que una pregunta
 * no quede sin pasos en ninguna de sus dos ramas, y que no se cuele una
 * pregunta que se contesta sola. Todo vuelve como problema explicado, no como
 * `null`, para que el modelo corrija en la misma vuelta.
 */
import type { AutomationTriggerType } from '@/types'
import type { BuilderStepInput } from './steps-tree'
import { activationIssues } from './activation'
import { conditionDataPoints, DATA_POINTS } from './data-points'
import {
  TIME_DP_ID,
  cfgDeDato,
  datoPorId,
  datoUsable,
  opsDe,
  OPS_CONDICION,
} from './condition-config'
import { translate } from '@/lib/i18n/translate'
import type { ValidationIssue } from './validate'
import type { Artefacto, PasoArtefacto } from '@/lib/operator/artifacts'

/** Los pasos que el Operador puede armar: los mismos once del lienzo. */
export const AI_STEP_TYPES = [
  'send_message',
  'send_template',
  'wait',
  'add_tag',
  'remove_tag',
  'condition',
  'close_conversation',
  'assign_conversation',
  'update_contact_field',
  'send_webhook',
  'voice_call',
] as const

export type AiStepType = (typeof AI_STEP_TYPES)[number]

/**
 * Los disparadores que puede elegir, con nombre entendible y qué le falta.
 *
 * **No están todos los del lienzo, y es a propósito.** `tag_added` y
 * `time_based` se ofrecen en la pantalla pero hoy no hay nada en el repo que
 * los dispare: no existe un solo `runAutomationsForTrigger({ triggerType:
 * 'tag_added' })`. Ofrecerlos acá sería entregar exactamente la falla que este
 * archivo viene a arreglar — algo que se crea, se puede prender, y no corre
 * nunca. Entran el día que exista quien los llame.
 */
export const AI_TRIGGERS: {
  value: AutomationTriggerType
  que: string
  /** Qué hay que completar para poder prenderla. */
  pide?: string
}[] = [
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
  { value: 'voice_call_completed', que: 'terminó una llamada' },
  {
    value: 'customer_inactive',
    que: 'un cliente lleva días sin comprar',
    pide: 'dias: cuántos días sin comprar',
  },
  {
    value: 'post_delivery_feedback',
    que: 'pasaron días desde la entrega',
    pide: 'dias: cuántos días después de entregado',
  },
  {
    value: 'keyword_match',
    que: 'alguien escribe una palabra',
    pide: 'palabras y coincidencia (exact o contains)',
  },
]

const TRIGGERS = new Set<string>(AI_TRIGGERS.map((t) => t.value))

/** Los datos sobre los que se puede preguntar. Sale del registro del lienzo. */
const DATOS_CONDICION = DATA_POINTS.filter((d) => d.usableInConditions)
const DATOS_VALIDOS = new Set<string>([...DATOS_CONDICION.map((d) => d.id), TIME_DP_ID])

/** Qué espera cada dato además del comparador. Para la leyenda del esquema. */
function pistaDe(id: string): string {
  const dp = datoPorId(id)
  if (id === TIME_DP_ID) return ' — el rango va en valor, "09:00-18:00"'
  if (!dp) return ''
  switch (dp.condition.kind) {
    case 'tag':
      return ' — el nombre va en etiqueta'
    case 'segment':
      return ' — el nombre va en grupo'
    case 'message':
      return ' — el texto a buscar va en valor'
    case 'purchased':
    case 'messaged':
    case 'rejected_open':
      return ' — sí/no, con ventana (since_trigger, ever, "48h", "7d")'
    case 'order_paid':
      return ' — sí/no'
    default:
      return dp.valueKind === 'number' ? ' — número, admite comparador' : ' — texto o número'
  }
}

const LEYENDA_DATOS = [
  ...DATOS_CONDICION.map((d) => `${d.id} = ${translate('es', d.labelKey)}${pistaDe(d.id)}`),
  `${TIME_DP_ID} = La hora del día${pistaDe(TIME_DP_ID)}`,
].join(' · ')

/**
 * Hasta dónde puede anidar preguntas.
 *
 * Cuatro no es un número redondo: es el que necesita el caso que lo motivó.
 * "Recompra distinta según si compró 1, 2-3 o 4+ unidades, y en cada caso
 * fijate si ya volvió a comprar antes de escribirle" son tres preguntas
 * encadenadas por el NO más una adentro de cada rama. Con el límite viejo de
 * uno era directamente imposible de expresar.
 *
 * Más que esto no se lee de un vistazo, y quien aprueba tiene que poder
 * entenderlo. El error lo dice y sugiere partirlo en dos.
 */
export const MAX_PROFUNDIDAD = 4

const PROPS_PASO = {
  tipo: { type: 'string', enum: [...AI_STEP_TYPES] },
  texto: {
    type: 'string',
    description:
      'Para send_message. Las variables son {{vars.customer_name}}, {{vars.first_item}}, {{vars.order_name}}… Cualquier otra cosa entre llaves sale VACÍA.',
  },
  plantilla: {
    type: 'string',
    description: 'Para send_template: el nombre exacto de una plantilla ya aprobada.',
  },
  idioma: { type: 'string', description: 'Para send_template. Por defecto es.' },
  etiqueta: {
    type: 'string',
    description:
      'El nombre de la etiqueta. Para add_tag y remove_tag, y para la pregunta dato=has_tag.',
  },
  grupo: { type: 'string', description: 'Para la pregunta dato=in_segment: el nombre del grupo.' },
  cantidad: { type: 'number', description: 'Para wait: cuánto espera.' },
  unidad: { type: 'string', enum: ['minutes', 'hours', 'days'] },
  dato: {
    type: 'string',
    enum: [...DATOS_VALIDOS],
    description: `Para condition: QUÉ dato mira la pregunta. ${LEYENDA_DATOS}`,
  },
  comparador: {
    type: 'string',
    enum: [...OPS_CONDICION],
    description:
      'Cómo comparar, sólo para los datos de número o texto. eq es igual, gte mayor o igual, between entre dos.',
  },
  valor: { type: 'string', description: 'Con qué comparar.' },
  valor2: { type: 'string', description: 'El otro extremo, sólo con comparador=between.' },
  ventana: {
    type: 'string',
    description:
      'Desde cuándo, para las preguntas de compra o de mensajes: since_trigger (desde que arrancó esta automatización), ever, "48h", "7d".',
  },
  campo: {
    type: 'string',
    enum: ['name', 'email', 'company'],
    description: 'Para update_contact_field: qué dato del contacto se escribe.',
  },
  url: { type: 'string', description: 'Para send_webhook: http o https.' },
  agente_voz: {
    type: 'string',
    description: 'Para voice_call: el nombre del agente que hace la llamada.',
  },
  objetivo: { type: 'string', description: 'Para voice_call: qué tiene que lograr la llamada.' },
} as const

/** Las mismas propiedades, sin la prosa. Los enums son lo que evita el error. */
const PROPS_PASO_CORTAS = Object.fromEntries(
  Object.entries(PROPS_PASO).map(([k, v]) => {
    const resto = { ...(v as Record<string, unknown>) }
    delete resto.description
    return [k, resto]
  }),
)

/**
 * El esquema de un paso, con sus ramas hasta `MAX_PROFUNDIDAD`.
 *
 * Se genera en vez de escribirse tres veces: copiar y pegar el bloque de
 * propiedades es la forma segura de que el tercer nivel se quede sin el campo
 * que se agregó al primero. Los niveles de adentro van sin descripciones —
 * viajan en cada llamada al modelo y ya dijeron lo que tenían que decir.
 */
function nivelPaso(profundidad: number, conProsa: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = conProsa
    ? { ...PROPS_PASO }
    : { ...PROPS_PASO_CORTAS }
  if (profundidad > 1) {
    const hijo = nivelPaso(profundidad - 1, false)
    properties.si = { type: 'array', items: hijo, description: 'Los pasos si la pregunta da SÍ.' }
    properties.no = { type: 'array', items: hijo, description: 'Los pasos si da NO.' }
  }
  return {
    type: 'object',
    properties,
    required: ['tipo'],
    ...(conProsa ? {} : { description: 'Un paso, con los mismos campos que los de arriba.' }),
  }
}

/** Un paso suelto, con sus ramas. Aparte porque los patches agregan de a uno. */
export const AI_PASO_SCHEMA = nivelPaso(MAX_PROFUNDIDAD, true)

export const AI_STEPS_SCHEMA = {
  type: 'object' as const,
  properties: {
    nombre: { type: 'string' },
    disparador: {
      type: 'string',
      enum: AI_TRIGGERS.map((x) => x.value),
      description: AI_TRIGGERS.map(
        (t) => `${t.value} = cuando ${t.que}${t.pide ? ` [pide ${t.pide}]` : ''}`,
      ).join(' · '),
    },
    dias: {
      type: 'number',
      description:
        'Para customer_inactive (días sin comprar) y post_delivery_feedback (días desde la entrega).',
    },
    palabras: { type: 'array', items: { type: 'string' }, description: 'Para keyword_match.' },
    coincidencia: { type: 'string', enum: ['exact', 'contains'] },
    pasos: { type: 'array', items: AI_PASO_SCHEMA },
  },
  required: ['nombre', 'disparador', 'pasos'],
}

export interface AiPaso {
  tipo: string
  texto?: string
  plantilla?: string
  idioma?: string
  etiqueta?: string
  grupo?: string
  cantidad?: number
  unidad?: string
  dato?: string
  comparador?: string
  valor?: string
  valor2?: string
  ventana?: string
  campo?: string
  url?: string
  agente_voz?: string
  objetivo?: string
  si?: AiPaso[]
  no?: AiPaso[]
}

export interface ContextoTraduccion {
  disparador: AutomationTriggerType
  /** Si en este camino ya hubo una espera. Cambia qué preguntas tienen sentido. */
  huboEspera?: boolean
  /** Cuántos niveles de pregunta quedan. */
  resto?: number
}

export interface Traduccion {
  paso: BuilderStepInput | null
  problemas: ValidationIssue[]
}

/**
 * Traduce un paso del modelo a lo que entiende el constructor.
 *
 * Exportado además de usarse acá: los patches de `ai-patches.ts` agregan pasos
 * sueltos a un árbol que ya existe, y tienen que traducirlos con esta misma
 * función. Con una copia propia, "agregar una espera" habría aceptado formas
 * que al crear se rechazan.
 *
 * Devuelve los problemas y no `null` a secas: devolver `null` fue el agujero
 * por el que se colaban los hijos inválidos de una rama, que se filtraban en
 * silencio mientras el chequeo de "descarté algo" sólo miraba la raíz.
 */
export function pasoDesdeIA(p: AiPaso, ctx: ContextoTraduccion): Traduccion {
  const problemas: ValidationIssue[] = []
  const paso = aPaso(p, 'paso', problemas, {
    disparador: ctx.disparador,
    huboEspera: ctx.huboEspera ?? false,
    resto: ctx.resto ?? MAX_PROFUNDIDAD,
  })
  return { paso, problemas }
}

function falta(problemas: ValidationIssue[], path: string, message: string): null {
  problemas.push({ path, message })
  return null
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Las variables que el motor reemplaza de verdad. Cualquier otra sale vacía. */
const VARIABLES_RE = /\{\{\s*([\w.]+)\s*\}\}/g

function variablesInvalidas(s: string): string[] {
  const malas: string[] = []
  for (const m of s.matchAll(VARIABLES_RE)) {
    const clave = m[1]
    if (clave === 'message.text') continue
    if (clave.startsWith('vars.') && clave.length > 5) continue
    malas.push(m[0])
  }
  return malas
}

function aPaso(
  p: AiPaso,
  ruta: string,
  problemas: ValidationIssue[],
  ctx: Required<ContextoTraduccion>,
): BuilderStepInput | null {
  switch (p.tipo) {
    case 'send_message': {
      const cuerpo = texto(p.texto)
      if (!cuerpo) {
        return falta(problemas, `${ruta}.texto`, 'un mensaje sin texto no se puede mandar')
      }
      // El motor sólo entiende {{vars.X}} y {{message.text}}: cualquier otra
      // llave se reemplaza por vacío. "Hola {{nombre}}" salía como "Hola ".
      const malas = variablesInvalidas(cuerpo)
      if (malas.length > 0) {
        return falta(
          problemas,
          `${ruta}.texto`,
          `${malas.join(', ')} sale vacío. Las variables se escriben {{vars.customer_name}}, {{vars.first_item}}, {{vars.order_name}}…`,
        )
      }
      return { step_type: 'send_message', step_config: { text: cuerpo } }
    }

    case 'send_template':
      return texto(p.plantilla)
        ? {
            step_type: 'send_template',
            step_config: {
              template_name: texto(p.plantilla),
              language: texto(p.idioma) || 'es',
              variables: {},
            },
          }
        : falta(problemas, `${ruta}.plantilla`, 'falta el nombre de la plantilla')

    case 'wait': {
      const cantidad = Number(p.cantidad)
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        return falta(problemas, `${ruta}.cantidad`, 'la espera tiene que ser mayor que cero')
      }
      if (!['minutes', 'hours', 'days'].includes(String(p.unidad))) {
        return falta(problemas, `${ruta}.unidad`, 'la unidad tiene que ser minutes, hours o days')
      }
      return { step_type: 'wait', step_config: { amount: cantidad, unit: String(p.unidad) } }
    }

    case 'add_tag':
    case 'remove_tag':
      // Va en `tag_name` y NO en `tag_id`: `resolverEtiquetas` busca ese campo
      // para crear la etiqueta en la cuenta y rellenar el id de verdad. Puesto
      // en `tag_id`, el nombre se guardaba donde va un uuid — la validación de
      // activación lo frenaba, así que la automatización quedaba imposible de
      // prender y nadie sabía por qué.
      return texto(p.etiqueta)
        ? { step_type: p.tipo, step_config: { tag_name: texto(p.etiqueta) } }
        : falta(problemas, `${ruta}.etiqueta`, 'falta el nombre de la etiqueta')

    case 'close_conversation':
      return { step_type: 'close_conversation', step_config: {} }

    case 'assign_conversation':
      // Sólo por turnos: asignársela a una persona concreta necesita su id, y
      // un id que el modelo no puede conocer es un id que va a inventar.
      return { step_type: 'assign_conversation', step_config: { mode: 'round_robin' } }

    case 'update_contact_field': {
      const campo = texto(p.campo)
      // El motor sólo escribe estos tres; cualquier otro devuelve "field not
      // writable" y la corrida sigue como si nada.
      if (!['name', 'email', 'company'].includes(campo)) {
        return falta(
          problemas,
          `${ruta}.campo`,
          'de un contacto sólo se puede escribir name, email o company',
        )
      }
      if (!texto(p.valor)) return falta(problemas, `${ruta}.valor`, 'falta el valor a escribir')
      return {
        step_type: 'update_contact_field',
        step_config: { field: campo, value: texto(p.valor) },
      }
    }

    case 'send_webhook': {
      const url = texto(p.url)
      if (!url) return falta(problemas, `${ruta}.url`, 'falta la dirección del webhook')
      try {
        const u = new URL(url)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return falta(problemas, `${ruta}.url`, 'la dirección tiene que empezar con http o https')
        }
      } catch {
        return falta(problemas, `${ruta}.url`, 'esa no es una dirección válida')
      }
      return { step_type: 'send_webhook', step_config: { url } }
    }

    case 'voice_call': {
      // El agente viaja por NOMBRE y se resuelve al guardar, igual que las
      // etiquetas: el modelo no puede conocer un uuid, y dejarlo inventarlo
      // fue exactamente el error que rompió las preguntas.
      const nombre = texto(p.agente_voz)
      if (!nombre) return falta(problemas, `${ruta}.agente_voz`, 'falta qué agente llama')
      return {
        step_type: 'voice_call',
        step_config: {
          agent_name: nombre,
          ...(texto(p.objetivo) ? { objective_override: texto(p.objetivo) } : {}),
          wait_for_result: true,
        },
      }
    }

    case 'condition':
      return aCondicion(p, ruta, problemas, ctx)

    default:
      return falta(
        problemas,
        `${ruta}.tipo`,
        `«${p.tipo}» no es un paso que exista. Los que hay: ${AI_STEP_TYPES.join(', ')}`,
      )
  }
}

function aCondicion(
  p: AiPaso,
  ruta: string,
  problemas: ValidationIssue[],
  ctx: Required<ContextoTraduccion>,
): BuilderStepInput | null {
  const id = texto(p.dato)
  if (!id) return falta(problemas, `${ruta}.dato`, 'la pregunta no dice qué dato mira')

  if (!DATOS_VALIDOS.has(id)) {
    const cerca = parecido(id)
    return falta(
      problemas,
      `${ruta}.dato`,
      `«${id}» no es un dato que exista.${cerca ? ` ¿Querías «${cerca}»?` : ''} Los que hay: ${[...DATOS_VALIDOS].join(', ')}`,
    )
  }

  if (!datoUsable(id, ctx.disparador)) {
    const hay = conditionDataPoints(ctx.disparador).map((d) => d.id)
    return falta(
      problemas,
      `${ruta}.dato`,
      `«${id}» no existe cuando el disparador es «${ctx.disparador}»: la pregunta daría siempre que no. Para ese disparador hay: ${[...hay, TIME_DP_ID].join(', ')}`,
    )
  }

  const dp = datoPorId(id)
  const cfg: Record<string, unknown> =
    id === TIME_DP_ID
      ? { subject: 'time_of_day', operand: texto(p.valor) }
      : { ...cfgDeDato(dp!) }

  const comparador = texto(p.comparador)
  const admite = dp ? opsDe(dp) : []
  if (comparador) {
    if (admite.length === 0) {
      return falta(
        problemas,
        `${ruta}.comparador`,
        `«${id}» no se compara con mayor o menor: es una pregunta de sí o no`,
      )
    }
    if (!OPS_CONDICION.includes(comparador as (typeof OPS_CONDICION)[number])) {
      return falta(problemas, `${ruta}.comparador`, `«${comparador}» no es una comparación válida`)
    }
    cfg.op = comparador
  }

  const clase = dp?.condition.kind
  switch (clase) {
    case 'tag': {
      const nombre = texto(p.etiqueta)
      if (!nombre) {
        return falta(problemas, `${ruta}.etiqueta`, 'falta el nombre de la etiqueta a preguntar')
      }
      // Viaja por nombre y se convierte en uuid al guardar. Sin esto quedaba
      // el nombre donde el motor busca un id: la pregunta daba siempre que no.
      cfg.operand = ''
      cfg.tag_name = nombre
      cfg.value = ''
      break
    }
    case 'segment': {
      const nombre = texto(p.grupo)
      if (!nombre) return falta(problemas, `${ruta}.grupo`, 'falta el nombre del grupo')
      cfg.operand = ''
      cfg.segment_name = nombre
      cfg.value = ''
      break
    }
    case 'message': {
      const buscado = texto(p.valor)
      // Sin texto, `includes('')` da que sí para cualquier mensaje: la
      // pregunta se contesta sola y siempre manda.
      if (!buscado) return falta(problemas, `${ruta}.valor`, 'falta qué texto buscar en el mensaje')
      cfg.operand = buscado
      cfg.value = buscado
      break
    }
    case 'purchased':
    case 'messaged':
    case 'rejected_open': {
      const ventana = texto(p.ventana) || String(cfg.operand ?? 'since_trigger')
      if (!ventanaValida(ventana)) {
        return falta(
          problemas,
          `${ruta}.ventana`,
          `«${ventana}» no es una ventana: usá since_trigger, ever, o algo como "48h" o "7d"`,
        )
      }
      if (ventana === 'since_trigger' && !ctx.huboEspera) {
        return falta(
          problemas,
          `${ruta}.ventana`,
          'preguntar por lo que pasó "desde que arrancó" sin una espera antes da siempre que no. Poné la espera primero o elegí una ventana como "7d"',
        )
      }
      cfg.operand = ventana
      // Siempre en positivo: la rama del SÍ significa que el hecho es cierto.
      cfg.value = 'true'
      break
    }
    case 'order_paid': {
      if (!ctx.huboEspera && ctx.disparador === 'shopify_order_paid') {
        return falta(
          problemas,
          `${ruta}.dato`,
          '«el pedido está pagado» justo después de «se pagó un pedido» da siempre que sí. ¿Querías preguntar si volvió a comprar (purchased), o falta una espera antes?',
        )
      }
      delete cfg.operand
      cfg.value = 'true'
      break
    }
    default: {
      // Datos de número o de texto: van con su comparador y su valor.
      const valor = texto(p.valor)
      if (!valor) return falta(problemas, `${ruta}.valor`, 'falta con qué comparar')
      const op = String(cfg.op ?? 'eq')
      if (op !== 'eq' && !Number.isFinite(Number(valor))) {
        return falta(problemas, `${ruta}.valor`, `para comparar con ${op} hace falta un número`)
      }
      cfg.value = valor
      if (op === 'between') {
        const otro = texto(p.valor2)
        if (!Number.isFinite(Number(otro))) {
          return falta(problemas, `${ruta}.valor2`, 'comparar entre dos números necesita los dos')
        }
        cfg.value2 = otro
      }
      break
    }
  }

  if (id === TIME_DP_ID && !texto(p.valor)) {
    return falta(problemas, `${ruta}.valor`, 'falta el rango de horas, como "09:00-18:00"')
  }

  if (ctx.resto < 1) {
    return falta(
      problemas,
      ruta,
      `demasiadas preguntas encadenadas (máximo ${MAX_PROFUNDIDAD}). Reordenalo o hacelo en dos automatizaciones`,
    )
  }

  const hijos: Required<ContextoTraduccion> = { ...ctx, resto: ctx.resto - 1 }
  const yes = rama(p.si, `${ruta}.si`, problemas, hijos)
  const no = rama(p.no, `${ruta}.no`, problemas, hijos)

  // Una pregunta cuyas dos respuestas no hacen nada es una pregunta que no se
  // hizo. El motor la acepta y sigue de largo sin decir nada, así que sin este
  // corte queda un paso decorativo que nadie nota.
  if (yes.length === 0 && no.length === 0) {
    return falta(problemas, ruta, 'la pregunta no tiene qué hacer ni con el sí ni con el no')
  }

  // Los `undefined` que deja `cfgDeDato` para la pantalla no van a la base.
  for (const k of Object.keys(cfg)) if (cfg[k] === undefined) delete cfg[k]

  return { step_type: 'condition', step_config: cfg, branches: { yes, no } }
}

function rama(
  pasos: AiPaso[] | undefined,
  ruta: string,
  problemas: ValidationIssue[],
  ctx: Required<ContextoTraduccion>,
): BuilderStepInput[] {
  const out: BuilderStepInput[] = []
  let huboEspera = ctx.huboEspera
  ;(pasos ?? []).forEach((hijo, i) => {
    const paso = aPaso(hijo, `${ruta}[${i}]`, problemas, { ...ctx, huboEspera })
    if (paso) {
      out.push(paso)
      if (paso.step_type === 'wait') huboEspera = true
    }
  })
  return out
}

const VENTANA_RE = /^\d+[mhd]$/i

function ventanaValida(v: string): boolean {
  return v === 'since_trigger' || v === 'ever' || VENTANA_RE.test(v)
}

/** El dato más parecido, para convertir un error en un arreglo de una vuelta. */
function parecido(id: string): string | null {
  const buscado = id.toLowerCase()
  let mejor: { id: string; d: number } | null = null
  for (const candidato of DATOS_VALIDOS) {
    const d = distancia(buscado, candidato.toLowerCase())
    if (d <= 3 && (!mejor || d < mejor.d)) mejor = { id: candidato, d }
  }
  return mejor?.id ?? null
}

function distancia(a: string, b: string): number {
  if (a === b) return 0
  if (b.includes(a) || a.includes(b)) return 1
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0]
    fila[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = fila[j]
      fila[j] = Math.min(
        fila[j] + 1,
        fila[j - 1] + 1,
        previo + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      previo = tmp
    }
  }
  return fila[b.length]
}

/**
 * Un paso contado en una línea, para dibujarlo.
 *
 * El texto va recortado: en el árbol se lee de un vistazo si es el mensaje que
 * se pidió, no se lee entero. Y las preguntas se leen en castellano —"¿Unidades
 * de su última compra ≥ 3?"— y no como el nombre interno del sujeto, que era lo
 * que se dibujaba antes y no significaba nada para quien vende.
 */
export function resumirPaso(p: AiPaso): PasoArtefacto {
  const corto = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  switch (p.tipo) {
    case 'send_message':
      return { tipo: p.tipo, resumen: `«${corto(p.texto ?? '')}»` }
    case 'send_template':
      // Una receta deja la plantilla en blanco a propósito, para que el
      // comercio elija. Dibujarlo como "Plantilla " a secas no dice que falta.
      return {
        tipo: p.tipo,
        resumen: p.plantilla ? `Plantilla ${p.plantilla}` : 'Falta elegir la plantilla',
      }
    case 'wait':
      return { tipo: p.tipo, resumen: `Espera ${p.cantidad} ${enCastellano(p.unidad)}` }
    case 'add_tag':
      return {
        tipo: p.tipo,
        resumen: p.etiqueta
          ? `Le pone la etiqueta «${p.etiqueta}»`
          : 'Falta elegir la etiqueta que le pone',
      }
    case 'remove_tag':
      return {
        tipo: p.tipo,
        resumen: p.etiqueta
          ? `Le saca la etiqueta «${p.etiqueta}»`
          : 'Falta elegir la etiqueta que le saca',
      }
    case 'close_conversation':
      return { tipo: p.tipo, resumen: 'Cierra la conversación' }
    case 'assign_conversation':
      return { tipo: p.tipo, resumen: 'Se la asigna a alguien del equipo' }
    case 'update_contact_field':
      return { tipo: p.tipo, resumen: `Anota ${p.campo ?? ''}: ${p.valor ?? ''}` }
    case 'send_webhook':
      return { tipo: p.tipo, resumen: `Avisa a ${corto(p.url ?? '', 40)}` }
    case 'voice_call':
      return { tipo: p.tipo, resumen: `Llama con ${p.agente_voz ?? 'el agente de voz'}` }
    case 'condition':
      return {
        tipo: p.tipo,
        resumen: pregunta(p),
        si: (p.si ?? []).map(resumirPaso),
        no: (p.no ?? []).map(resumirPaso),
      }
    default:
      return { tipo: p.tipo, resumen: p.tipo }
  }
}

function enCastellano(u: string | undefined): string {
  return u === 'days' ? 'días' : u === 'hours' ? 'horas' : u === 'minutes' ? 'minutos' : (u ?? '')
}

const SIGNO: Record<string, string> = { gte: '≥', gt: '>', lte: '≤', lt: '<' }

function pregunta(p: AiPaso): string {
  const id = texto(p.dato)
  if (id === TIME_DP_ID) return `¿Entre las ${p.valor ?? ''}?`
  const dp = datoPorId(id)
  if (!dp) return `¿${id}?`
  const nombre = translate('es', dp.labelKey)
  switch (dp.condition.kind) {
    case 'tag':
      return `¿Tiene la etiqueta «${p.etiqueta ?? ''}»?`
    case 'segment':
      return `¿Está en «${p.grupo ?? ''}»?`
    case 'message':
      return `¿El mensaje dice «${p.valor ?? ''}»?`
    case 'purchased':
      return `¿Volvió a comprar${ventana(p.ventana)}?`
    case 'messaged':
      return `¿Ya le escribimos${ventana(p.ventana)}?`
    case 'rejected_open':
      return `¿Tiene un pago rechazado sin resolver${ventana(p.ventana)}?`
    case 'order_paid':
      return '¿El pedido ya está pagado?'
    default: {
      const op = texto(p.comparador) || 'eq'
      if (op === 'between') return `¿${nombre} entre ${p.valor} y ${p.valor2}?`
      if (SIGNO[op]) return `¿${nombre} ${SIGNO[op]} ${p.valor}?`
      return `¿${nombre} es ${p.valor ?? ''}?`
    }
  }
}

function ventana(v: string | undefined): string {
  if (!v || v === 'since_trigger') return ' desde que arrancó'
  if (v === 'ever') return ' alguna vez'
  const m = /^(\d+)([mhd])$/i.exec(v)
  if (!m) return ''
  const u = m[2].toLowerCase()
  return ` en ${m[1]} ${u === 'm' ? 'minutos' : u === 'h' ? 'horas' : 'días'}`
}

/** La automatización dibujada, desde lo que pidió el modelo. */
export function artefactoDePlan(entrada: {
  nombre?: string
  disparador?: string
  pasos?: AiPaso[]
}): Artefacto | null {
  const nombre = (entrada.nombre ?? '').trim()
  if (!nombre || !Array.isArray(entrada.pasos)) return null
  const cuando =
    AI_TRIGGERS.find((x) => x.value === entrada.disparador)?.que ??
    String(entrada.disparador ?? '')
  return {
    kind: 'automatizacion',
    nombre,
    cuando,
    pasos: entrada.pasos.map(resumirPaso),
  }
}

export interface PlanAutomatizacion {
  nombre: string
  disparador: AutomationTriggerType
  disparadorConfig: Record<string, unknown>
  pasos: BuilderStepInput[]
  /** Cuántos pasos hay en total, ramas incluidas. Para la vista previa. */
  total: number
}

/** Cuenta el árbol entero, no sólo la raíz. */
export function contarPasos(pasos: BuilderStepInput[]): number {
  return pasos.reduce(
    (n, p) => n + 1 + contarPasos(p.branches?.yes ?? []) + contarPasos(p.branches?.no ?? []),
    0,
  )
}

export interface AiEntradaPlan {
  nombre?: string
  disparador?: string
  dias?: number
  palabras?: string[]
  coincidencia?: string
  pasos?: AiPaso[]
}

/**
 * La misma plantilla en dos caminos distintos.
 *
 * Pasó en una cuenta real: se pidió «una recompra con un mensaje DISTINTO según
 * si compró 1, 2-3 o 4+ unidades», y las tres ramas terminaron mandando
 * `recompra_1` — la única plantilla aprobada que había. Nadie mintió: el
 * especialista no podía escribir plantillas y usó la que tenía. El resultado es
 * una automatización que se ve bien, se puede prender, y hace exactamente lo
 * contrario de lo que se pidió.
 *
 * Ramificar para mandar lo mismo no tiene sentido, así que se corta y se dice
 * qué hacer: pedirle las que faltan al de plantillas, o preguntarle a la
 * persona.
 *
 * **Sin escape.** Hubo uno —un `mismo_mensaje: true` que el modelo podía
 * mandar— y lo usó a la primera: cuando el camino corto es declarar que está
 * bien, se declara que está bien. Si de verdad va el mismo mensaje para todos,
 * la salida no es confirmarlo: es sacar la pregunta, porque no hace nada.
 */
function plantillaRepetida(pasos: BuilderStepInput[]): string | null {
  const porRama = new Map<string, number>()
  const mirar = (lista: BuilderStepInput[], enRama: boolean) => {
    for (const p of lista) {
      if (enRama && p.step_type === 'send_template') {
        const n = String((p.step_config as { template_name?: string }).template_name ?? '')
        if (n) porRama.set(n, (porRama.get(n) ?? 0) + 1)
      }
      if (p.branches) {
        mirar(p.branches.yes ?? [], true)
        mirar(p.branches.no ?? [], true)
      }
    }
  }
  mirar(pasos, false)
  for (const [nombre, veces] of porRama) {
    if (veces > 1) return nombre
  }
  return null
}

/**
 * Lo que el disparador necesita, traducido desde lo que dijo el modelo.
 *
 * Faltaba entero: `crear` guardaba `trigger_config: {}` fijo, así que el chat
 * NUNCA pudo crear una automatización por inactividad. La validación pedía
 * `days_threshold > 0` y lo que veía el comercio era *"Todavía no se puede:
 * days since last order must be greater than 0"* sobre algo que él no tenía
 * forma de completar.
 */
function configDeDisparador(
  disparador: AutomationTriggerType,
  e: AiEntradaPlan,
  problemas: ValidationIssue[],
): Record<string, unknown> {
  switch (disparador) {
    case 'customer_inactive':
    case 'post_delivery_feedback': {
      const dias = Number(e.dias)
      if (!Number.isFinite(dias) || dias <= 0) {
        problemas.push({
          path: 'dias',
          message:
            disparador === 'customer_inactive'
              ? 'decí cuántos días sin comprar tienen que pasar'
              : 'decí cuántos días después de la entrega',
        })
        return {}
      }
      return disparador === 'customer_inactive'
        ? { days_threshold: dias }
        : { days_after: dias }
    }
    case 'keyword_match': {
      const palabras = Array.isArray(e.palabras)
        ? e.palabras.map((x) => texto(x)).filter(Boolean)
        : []
      if (palabras.length === 0) {
        problemas.push({ path: 'palabras', message: 'falta al menos una palabra' })
        return {}
      }
      const coincidencia = texto(e.coincidencia) || 'contains'
      if (coincidencia !== 'exact' && coincidencia !== 'contains') {
        problemas.push({
          path: 'coincidencia',
          message: 'la coincidencia tiene que ser exact o contains',
        })
        return {}
      }
      return { keywords: palabras, match_type: coincidencia }
    }
    default:
      return {}
  }
}

/**
 * Un uuid de mentira donde todavía viaja un nombre.
 *
 * La validación de activación exige ids, y acá las etiquetas, los grupos y los
 * agentes viajan por nombre hasta que se guardan. Antes esto se resolvía
 * filtrando los problemas por sufijo (`.tag_id`), que se desactualiza sola en
 * cuanto aparece una referencia más — y de paso escondía un hueco vacío que NO
 * tenía un nombre detrás, que sí es un error de verdad.
 */
export function simularResolucion(pasos: BuilderStepInput[]): BuilderStepInput[] {
  const FALSO = '00000000-0000-4000-8000-000000000000'
  return pasos.map((s) => {
    const cfg = { ...((s.step_config ?? {}) as Record<string, unknown>) }
    if (cfg.tag_name && !cfg.tag_id) {
      if (s.step_type === 'condition') cfg.operand = FALSO
      else cfg.tag_id = FALSO
    }
    if (cfg.segment_name && !cfg.operand) cfg.operand = FALSO
    if (cfg.agent_name && !cfg.agent_id) cfg.agent_id = FALSO
    return {
      ...s,
      step_config: cfg,
      ...(s.branches
        ? {
            branches: {
              yes: simularResolucion(s.branches.yes ?? []),
              no: simularResolucion(s.branches.no ?? []),
            },
          }
        : {}),
    }
  })
}

/**
 * Convierte lo que dijo el modelo, o explica por qué no se puede.
 *
 * Devolver los problemas en vez de tirar es a propósito: el modelo puede
 * corregir y volver a intentar en la misma vuelta, y la persona ve qué faltaba
 * en vez de un fallo mudo.
 */
export function planDesdeIA(entrada: AiEntradaPlan): {
  plan: PlanAutomatizacion | null
  problemas: ValidationIssue[]
} {
  const problemas: ValidationIssue[] = []
  const nombre = (entrada.nombre ?? '').trim()
  if (!nombre) problemas.push({ path: 'nombre', message: 'falta el nombre' })

  const disparador = entrada.disparador as AutomationTriggerType
  if (!TRIGGERS.has(disparador)) {
    problemas.push({
      path: 'disparador',
      message: `«${entrada.disparador}» no es un disparador que funcione. Los que hay: ${AI_TRIGGERS.map((t) => t.value).join(', ')}`,
    })
    return { plan: null, problemas }
  }

  const disparadorConfig = configDeDisparador(disparador, entrada, problemas)

  const crudos = Array.isArray(entrada.pasos) ? entrada.pasos : []
  const pasos: BuilderStepInput[] = []
  let huboEspera = false
  crudos.forEach((p, i) => {
    const paso = aPaso(p, `pasos[${i}]`, problemas, {
      disparador,
      huboEspera,
      resto: MAX_PROFUNDIDAD,
    })
    if (paso) {
      pasos.push(paso)
      if (paso.step_type === 'wait') huboEspera = true
    }
  })
  if (pasos.length === 0 && problemas.length === 0) {
    problemas.push({ path: 'pasos', message: 'no hay ningún paso' })
  }

  if (problemas.length > 0) return { plan: null, problemas }

  const repetida = plantillaRepetida(pasos)
  if (repetida) {
    return {
      plan: null,
      problemas: [
        {
          path: 'pasos',
          // Este texto lo leen los dos: vuelve al modelo como error de
          // herramienta y aparece en el chat como la fila que explica por qué
          // no se armó. Estaba escrito sólo para el modelo —con PÍDELE y
          // PREGÚNTALE en mayúsculas— y quien vende cremas se encontraba con un
          // instructivo ajeno. El hecho y las dos salidas alcanzan para los dos.
          message: `La plantilla «${repetida}» se manda en más de un camino. Si cada camino tiene que decir algo distinto, hacen falta tantas plantillas como caminos; si dicen lo mismo, sobra la pregunta.`,
        },
      ],
    }
  }

  // La misma puerta que cruza el editor: si esto no pasa, la automatización no
  // se va a poder prender nunca y crearla así sería crear algo muerto.
  const issues = activationIssues({
    triggerType: disparador,
    triggerConfig: disparadorConfig,
    steps: simularResolucion(pasos) as never,
  })

  if (issues.length > 0) return { plan: null, problemas: issues }
  return {
    plan: { nombre, disparador, disparadorConfig, pasos, total: contarPasos(pasos) },
    problemas: [],
  }
}
