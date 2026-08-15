import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'
import type { Locale } from '@/lib/i18n/config'

export type TemplateSlug =
  | 'carrito-abandonado'
  | 'pago-rechazado'
  | 'pago-pendiente'
  | 'nuevo-pedido'
  | 'enviar-tracking'
  | 'post-survey'
  | 'recompras'

export type TemplateCategory =
  | 'shopify'
  | 'ventas'
  | 'soporte'
  | 'retencion'
  | 'recordatorios'

/**
 * Lucide icon name (string). The page maps these to the actual
 * imported icon components — keeping the catalog import-free means
 * server-side code can read this file without dragging react into the
 * bundle.
 */
export type TemplateIconName =
  | 'shopping-cart'
  | 'credit-card'
  | 'package-check'
  | 'truck'
  | 'star'
  | 'repeat-2'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  /**
   * Pasarela de pago que esta receta necesita. Cuando está, la tarjeta sólo
   * se ofrece a quien la tiene conectada o a quien opera donde esa pasarela
   * existe (ver /api/automations/template-context). Sin esto, una tienda de
   * Estados Unidos vería para siempre una receta de Mercado Pago que nunca
   * va a poder usar.
   */
  requiresGateway?: 'mercadopago'
  name: string
  description: string
  /** Bucket the card belongs to. Used to colour-code or group. */
  category: TemplateCategory
  icon: TemplateIconName
  /** Short pills shown at the bottom of the gallery card. */
  tags: string[]
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
  /**
   * Suggested copy for the Meta-approved template the user must
   * register before activation. Kept here so the editor can show it as
   * pre-filled guidance. NOT stored anywhere — purely descriptive.
   */
  suggested_template_body?: string
}

/**
 * Galería curada de plantillas de automatizaciones. La sentamos en
 * sólo cinco recetas por pedido del equipo: cada una resuelve un
 * problema concreto del ciclo Shopify + WhatsApp.
 *
 * Reglas de seeding:
 *
 *  - `send_template` con `template_name: ''` para forzar al usuario a
 *    elegir una plantilla Meta aprobada (validate.ts no deja activar
 *    con string vacío). El motor solo soporta `send_template` fuera
 *    de la ventana de 24h, y todas estas plantillas pueden disparar
 *    fuera de la ventana (después de wait o tiempo absoluto).
 *  - Cada receta TERMINA con un paso `add_tag` con `tag_id: ''` (sin etiqueta
 *    por defecto): al usar la plantilla, el merchant escribe una etiqueta nueva
 *    o elige una existente (combobox write-or-pick en el editor). validate.ts
 *    exige un tag real antes de activar, así todo contacto que pasa por la
 *    automatización queda etiquetado — pedido del equipo.
 *
 * El editor surfacea el `suggested_template_body` como pista para que
 * el merchant registre el template en Meta con el cuerpo correcto.
 */
export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  'carrito-abandonado': {
    slug: 'carrito-abandonado',
    name: 'Carrito abandonado',
    description:
      'Recupera ventas: a los 15 minutos de abandonar el carrito, si todavía no compró, le mandamos el link para retomarlo. Marca como recuperado solo a quien compra después.',
    category: 'shopify',
    icon: 'shopping-cart',
    tags: ['Shopify', 'Espera 15 min'],
    trigger_type: 'shopify_abandoned_checkout',
    trigger_config: {},
    suggested_template_body:
      'Hola {{customer_name}}, dejaste tu carrito sin terminar. Te lo guardamos por si quieres retomarlo: {{checkout_url}}.',
    steps: [
      {
        // 1. Marcar el carrito abandonado, antes de todo. Es un hecho, no un
        //    resultado: cuando esto corre la persona YA dejó el carrito. Va
        //    primero para que la etiqueta esté puesta aunque después el flujo
        //    se corte —porque compró sola, porque ya le habíamos escrito— y
        //    para que se pueda segmentar por "abandonó" con independencia de
        //    si llegamos a escribirle.
        step_type: 'add_tag',
        step_config: { tag_id: '', tag_name: 'carrito-abandonado' },
      },
      {
        // 2. Esperar. La espera vive acá y no en el cron: el flujo se arma
        //    con las piezas de la plataforma y se ve entero en el lienzo.
        step_type: 'wait',
        step_config: { amount: 15, unit: 'minutes' },
      },
      {
        // 3. ¿Compró en el medio? Quien volvió y pagó no recibe nada.
        step_type: 'condition',
        step_config: { subject: 'purchased', operand: 'since_trigger', value: 'false' },
      },
      {
        // 4. ¿Tiene un pago rechazado sin resolver? Un rechazo de tarjeta
        //    deja el checkout abierto, así que la misma persona entra por los
        //    dos rescates. Gana el de pago: dice lo que pasó de verdad.
        step_type: 'condition',
        step_config: { subject: 'rejected_open', operand: '48h', value: 'false' },
        branch: 'yes',
        parent_index: 2,
      },
      {
        // 5. ¿Ya le escribimos? Cuenta CUALQUIER plantilla, no sólo las de
        //    rescate: dos días alcanzan para no insistirle a la misma persona
        //    por el mismo episodio sin apagar la recuperación. La ventana se
        //    edita en el paso, sin tocar código.
        step_type: 'condition',
        step_config: { subject: 'messaged', operand: '48h', value: 'false' },
        branch: 'yes',
        parent_index: 3,
      },
      {
        // 6. Recién ahí, el mensaje. Va plantilla y no texto libre porque el
        //    envío cae fuera de la ventana de 24 h de Meta.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
        branch: 'yes',
        parent_index: 4,
      },
      {
        // 7. La ventana de atribución. Dos días desde el mensaje: quien vuelve
        //    a comprar por un recordatorio de carrito lo hace el mismo día o
        //    al siguiente, y estirarlo más empieza a colgarse compras que la
        //    persona iba a hacer igual.
        step_type: 'wait',
        step_config: { amount: 48, unit: 'hours' },
        branch: 'yes',
        parent_index: 4,
      },
      {
        // 8. ¿Y ahora sí compró? En el paso 3 ya sabíamos que NO había
        //    comprado, así que una compra que aparezca acá es posterior al
        //    mensaje: es la venta que recuperó este flujo.
        step_type: 'condition',
        step_config: { subject: 'purchased', operand: 'since_trigger', value: 'true' },
        branch: 'yes',
        parent_index: 4,
      },
      {
        // 9. Sólo entonces la etiqueta de recuperado. Es la que dice cuánto
        //    vale esta automatización: puesta al mandar el mensaje marcaría a
        //    todo el que lo recibió y no significaría nada.
        step_type: 'add_tag',
        step_config: { tag_id: '', tag_name: 'carrito-recuperado' },
        branch: 'yes',
        parent_index: 7,
      },
    ],
  },

  'pago-rechazado': {
    slug: 'pago-rechazado',
    requiresGateway: 'mercadopago',
    name: 'Pago rechazado',
    description:
      'Al cliente se le rechazó el pago y a los 10 minutos todavía no completó la compra. Le escribimos para retomarla.',
    category: 'shopify',
    icon: 'credit-card',
    // La espera va en la píldora porque es LA decisión del flujo: es lo que
    // separa "se le rechazó el pago" de "no compró". Verla antes de abrir
    // la plantilla evita la duda de si esto le escribe a alguien que ya
    // pagó en el segundo intento.
    tags: ['Mercado Pago', 'Espera 10 min'],
    trigger_type: 'payment_rejected',
    // Sin configuración: la automatización corre desde que se instala y la
    // espera la pone el paso `Esperar` del flujo.
    trigger_config: {},
    suggested_template_body:
      'Hola {{customer_name}}, no pudimos procesar el pago de tu pedido por {{total_price}}. Responde este mensaje y te ayudamos a completar la compra.',
    steps: [
      {
        // 1. Esperar. Un rechazo se reintenta solo muy seguido: escribir al
        //    toque interrumpe a alguien que está en pleno checkout.
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        // 2. Preguntar si compró. Se evalúa DESPUÉS de la espera, que es el
        //    único momento en que la respuesta significa algo: quien pagó en
        //    el segundo intento sale del flujo por acá.
        step_type: 'condition',
        step_config: { subject: 'purchased', operand: 'since_trigger', value: 'false' },
      },
      {
        // 3. ¿Ya le escribimos en los últimos dos días? Cubre el cruce con el
        //    rescate de carrito:
        //    si esa persona ya recibió el "dejaste tu carrito", no se le suma
        //    este encima. El motor aplica la misma barrera igual, pero acá se
        //    ve y cada comercio elige su ventana.
        step_type: 'condition',
        step_config: { subject: 'messaged', operand: '48h', value: 'false' },
        branch: 'yes',
        parent_index: 1,
      },
      {
        // 4. Recién ahí se le escribe.
        //
        //    Va plantilla y no mensaje suelto porque el envío cae siempre
        //    fuera de la ventana de 24h de Meta. Categoría Utility: el aviso
        //    es transaccional (hay un pago que no prosperó), y las Marketing
        //    de este tipo se entregan mucho peor.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
        branch: 'yes',
        parent_index: 2,
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
        branch: 'yes',
        parent_index: 2,
      },
    ],
  },

  'pago-pendiente': {
    slug: 'pago-pendiente',
    name: 'Pago pendiente',
    description:
      'El cliente hizo el pedido pero todavía no pagó (transferencia). Le recordamos a la hora, a las 6 y a las 24, y paramos apenas paga.',
    category: 'shopify',
    icon: 'credit-card',
    tags: ['Shopify', 'Transferencia', '1 h · 6 h · 24 h'],
    trigger_type: 'shopify_order_created',
    trigger_config: {},
    suggested_template_body:
      'Hola {{customer_name}}, tu pedido {{order_name}} por {{total_price}} está reservado y esperando la transferencia. Cuando la hagas, mándanos el comprobante por acá.',
    steps: [
      {
        // 1. ¿Quedó esperando pago? Un pedido pagado con tarjeta sale del
        //    flujo acá mismo y no gasta ni una espera.
        step_type: 'condition',
        step_config: {
          subject: 'context_var',
          operand: 'financial_status',
          op: 'eq',
          value: 'pending',
        },
      },
      {
        // 2. Una hora. Suficiente para que pase por el banco sin que el
        //    recordatorio pise a la confirmación del pedido.
        step_type: 'wait',
        step_config: { amount: 1, unit: 'hours' },
        branch: 'yes',
        parent_index: 0,
      },
      {
        // 3. ¿Pagó mientras tanto? Se le pregunta a la tienda AHORA. El
        //    estado que trajo el webhook es el del momento del pedido y
        //    después de una espera no dice nada.
        step_type: 'condition',
        step_config: { subject: 'order_paid', value: 'false' },
        branch: 'yes',
        parent_index: 0,
      },
      {
        // 4. Primer recordatorio, con el alias.
        //
        //    Este flujo NO lleva el paso "ya le escribimos": no es un rescate
        //    cruzado, es el recordatorio del mismo pedido, y la confirmación
        //    de compra sale minutos antes. Su anti-duplicado es la pregunta
        //    de arriba — si pagó, no se manda nada.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
        branch: 'yes',
        parent_index: 2,
      },
      {
        // 5. Cinco horas más: seis desde el pedido.
        step_type: 'wait',
        step_config: { amount: 5, unit: 'hours' },
        branch: 'yes',
        parent_index: 2,
      },
      {
        step_type: 'condition',
        step_config: { subject: 'order_paid', value: 'false' },
        branch: 'yes',
        parent_index: 2,
      },
      {
        // 6. Segundo recordatorio: acá conviene ofrecer ayuda, no repetir.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
        branch: 'yes',
        parent_index: 5,
      },
      {
        // 7. Dieciocho horas más: veinticuatro desde el pedido.
        step_type: 'wait',
        step_config: { amount: 18, unit: 'hours' },
        branch: 'yes',
        parent_index: 5,
      },
      {
        step_type: 'condition',
        step_config: { subject: 'order_paid', value: 'false' },
        branch: 'yes',
        parent_index: 5,
      },
      {
        // 8. Último aviso y se deja de insistir.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
        branch: 'yes',
        parent_index: 8,
      },
      {
        // La etiqueta es lo que deja al pedido sin pagar visible en Contactos
        // y usable como segmento.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
        branch: 'yes',
        parent_index: 8,
      },
    ],
  },

  'nuevo-pedido': {
    slug: 'nuevo-pedido',
    name: 'Nuevo pedido',
    description:
      'Confirmamos al cliente apenas hace un pedido en Shopify. Le mandamos un resumen con el número de orden, el total y un agradecimiento.',
    category: 'shopify',
    icon: 'package-check',
    tags: ['Shopify', 'Confirmación'],
    trigger_type: 'shopify_order_created',
    trigger_config: {},
    suggested_template_body:
      'Gracias por tu compra, {{customer_name}}. Confirmamos el pedido {{order_name}} por {{total_price}} {{currency}}. Te avisamos apenas salga.',
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // Etiquetar al final — sin etiqueta por defecto: el merchant escribe una
        // nueva o elige una existente al usar la plantilla (validate exige un tag
        // real antes de activar).
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  'enviar-tracking': {
    slug: 'enviar-tracking',
    name: 'Enviar tracking',
    description:
      'Cuando despachamos un pedido, le mandamos al cliente el número de seguimiento y el link del courier.',
    category: 'shopify',
    icon: 'truck',
    tags: ['Shopify', 'Envíos'],
    trigger_type: 'shopify_order_fulfilled',
    trigger_config: {},
    suggested_template_body:
      'Tu pedido salió. Número de seguimiento: {{tracking_number}}. Lo sigues aquí: {{tracking_url}}.',
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // Etiquetar al final — sin etiqueta por defecto: el merchant escribe una
        // nueva o elige una existente al usar la plantilla (validate exige un tag
        // real antes de activar).
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  'post-survey': {
    slug: 'post-survey',
    name: 'Post survey',
    description:
      'Tres días después de que llega el pedido, le preguntamos al cliente cómo le fue. La respuesta queda registrada en la conversación para revisar.',
    category: 'retencion',
    icon: 'star',
    tags: ['Encuestas', 'Retención'],
    // Dedicated cron in /api/cron/shopify-feedback discovers
    // automations by this trigger_type + reads `days_after` from
    // trigger_config to know when to fire.
    trigger_type: 'post_delivery_feedback',
    trigger_config: { days_after: 3 },
    suggested_template_body:
      '{{customer_name}}, ¿cómo te fue con tu pedido? Cualquier feedback nos sirve un montón.',
    steps: [
      {
        // The cron dispatch always fires outside the 24h window —
        // send_template is the only safe choice.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
      },
      {
        // Etiquetar al final — sin etiqueta por defecto: el merchant escribe una
        // nueva o elige una existente al usar la plantilla (validate exige un tag
        // real antes de activar).
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },

  recompras: {
    slug: 'recompras',
    name: 'Recompras',
    description:
      'A los 45 días del último pedido, reactivamos al cliente — pero con un mensaje distinto según cuánto compró: a quien llevó por volumen (3+ unidades) le proponemos reponer con una oferta de volumen; a quien compró individual, volver a pedir su producto. Dispara una vez por ciclo.',
    category: 'retencion',
    icon: 'repeat-2',
    tags: ['Retención', 'Recompras'],
    // Dedicated cron in /api/cron/reengagement reads
    // `days_threshold` from trigger_config to know the inactivity
    // cutoff.
    trigger_type: 'customer_inactive',
    trigger_config: { days_threshold: 45 },
    suggested_template_body:
      'Hola {{customer_name}}, hace un tiempo de tu último pedido. ¿Quieres reponer? Te dejo el link para volver a comprar.',
    // Flujo ramificado: el camino se elige según las UNIDADES de la última
    // compra (last_offer_units, que el webhook de pedidos guarda en el
    // contacto). El merchant puede cambiar la condición por la oferta elegida
    // (last_offer_chosen) o el producto (last_product) desde el editor. Cada
    // rama termina etiquetando para segmentar después.
    steps: [
      {
        // 0 — ¿Compró por volumen (3+ unidades) la última vez?
        step_type: 'condition',
        step_config: {
          subject: 'contact_field',
          operand: 'last_offer_units',
          op: 'gte',
          value: '3',
        },
      },
      {
        // 1 — Sí (comprador de volumen): reponer con oferta de volumen.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
        parent_index: 0,
        branch: 'yes',
      },
      {
        // 2 — etiqueta de la rama de volumen.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
        parent_index: 0,
        branch: 'yes',
      },
      {
        // 3 — No (comprador individual): volver a pedir su producto.
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es', variables: {} },
        parent_index: 0,
        branch: 'no',
      },
      {
        // 4 — etiqueta de la rama individual.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
        parent_index: 0,
        branch: 'no',
      },
    ],
  },
}

/**
 * Order used by the gallery on /automatizaciones. Anything not listed
 * here is appended in object-iteration order.
 */
export const TEMPLATE_GALLERY_ORDER: TemplateSlug[] = [
  'carrito-abandonado',
  'pago-rechazado',
  'pago-pendiente',
  'nuevo-pedido',
  'enviar-tracking',
  'post-survey',
  'recompras',
]

/**
 * English variants of the suggested Meta-template body. The gallery
 * name/description are localized via i18n keys at the call sites; the seed
 * step content is mostly empty placeholders (template_name / tag_id the
 * merchant fills), so the only language-bearing pieces are this guidance
 * body and the `send_template` language code — both followed to the
 * merchant's locale so an English merchant doesn't seed Spanish defaults.
 */
const SUGGESTED_BODIES_EN: Partial<Record<TemplateSlug, string>> = {
  'carrito-abandonado':
    'Hi {{customer_name}}, you left your cart unfinished. We saved it in case you want to pick it back up: {{checkout_url}}.',
  'pago-pendiente':
    'Hi {{customer_name}}, your order {{order_name}} for {{total_price}} is reserved and waiting for the transfer. Send us the receipt here once you make it.',
  'nuevo-pedido':
    "Thanks for your purchase, {{customer_name}}. We confirmed order {{order_name}} for {{total_price}} {{currency}}. We'll let you know as soon as it ships.",
  'enviar-tracking':
    'Your order has shipped. Tracking number: {{tracking_number}}. Follow it here: {{tracking_url}}.',
  'post-survey':
    '{{customer_name}}, how did it go with your order? Any feedback really helps us.',
  recompras:
    "Hi {{customer_name}}, it's been a while since your last order. Want to restock? Here's the link to buy again.",
}

function localizeTemplate(
  t: AutomationTemplateDefinition,
  locale: Locale,
): AutomationTemplateDefinition {
  if (locale !== 'en') return t
  return {
    ...t,
    suggested_template_body: SUGGESTED_BODIES_EN[t.slug] ?? t.suggested_template_body,
    steps: t.steps.map((s) =>
      s.step_type === 'send_template'
        ? {
            ...s,
            step_config: {
              ...(s.step_config as Record<string, unknown>),
              language: 'en',
            } as AutomationStepConfig,
          }
        : s,
    ),
  }
}

export function getTemplate(
  slug: string,
  locale: Locale = 'es',
): AutomationTemplateDefinition | null {
  const t = AUTOMATION_TEMPLATES[slug as TemplateSlug]
  return t ? localizeTemplate(t, locale) : null
}

/**
 * i18n keys for a template's gallery name / pitch, resolved by the UI
 * (`useT`) so the gallery follows the active locale. The literal
 * `name`/`description` on the definition are the Spanish source-of-truth
 * fallback. `suggested_template_body` and step copy are NOT keyed here —
 * those are customer-facing message bodies the merchant edits.
 */
export function automationTemplateNameKey(slug: string): string {
  return `automations.tpl_${slug}_name`
}
export function automationTemplateDescKey(slug: string): string {
  return `automations.tpl_${slug}_desc`
}

export function listTemplates(locale: Locale = 'es'): AutomationTemplateDefinition[] {
  const seen = new Set<TemplateSlug>()
  const out: AutomationTemplateDefinition[] = []
  for (const slug of TEMPLATE_GALLERY_ORDER) {
    const t = AUTOMATION_TEMPLATES[slug]
    if (t) {
      out.push(localizeTemplate(t, locale))
      seen.add(slug)
    }
  }
  for (const slug of Object.keys(AUTOMATION_TEMPLATES) as TemplateSlug[]) {
    if (!seen.has(slug)) out.push(localizeTemplate(AUTOMATION_TEMPLATES[slug], locale))
  }
  return out
}
